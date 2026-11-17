import type {
  AttachmentMeta,
  AuthResponse,
  ChatMessage,
  DirectoryUser,
  PublicUser,
} from '../types';

const TOKEN_STORAGE_KEY = 'relaychat_auth_token';

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  skipAuth = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (!skipAuth) {
    const token = getStoredToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 401 && !skipAuth) {
    unauthorizedHandler?.();
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`,
    );
  }

  return data as T;
}

export function loginUser(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    true,
  );
}

export function registerUser(params: {
  name: string;
  email: string;
  password: string;
  role?: string;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>(
    '/api/auth/register',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
    true,
  );
}

export function fetchCurrentUser(): Promise<{ user: PublicUser }> {
  return apiFetch<{ user: PublicUser }>('/api/auth/me');
}

export function fetchUsersDirectory(): Promise<{ users: DirectoryUser[] }> {
  return apiFetch<{ users: DirectoryUser[] }>('/api/users');
}

export function fetchMessages(peerId: string): Promise<{ messages: ChatMessage[] }> {
  return apiFetch<{ messages: ChatMessage[] }>(`/api/messages/${encodeURIComponent(peerId)}`);
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.csv',
  '.xlsx',
  '.zip',
]);

export function validateAttachmentFile(file: File): string | null {
  const dotIdx = file.name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return 'Unsupported file type. Allowed: PNG, JPG, GIF, WEBP, PDF, DOC, DOCX, TXT, CSV, XLSX, ZIP.';
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File is larger than the 10 MB upload limit.';
  }
  if (file.size === 0) {
    return 'Cannot upload an empty file.';
  }
  return null;
}

export function uploadFileWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): { promise: Promise<AttachmentMeta>; abort: () => void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<AttachmentMeta>((resolve, reject) => {
    const token = getStoredToken();
    if (!token) {
      reject(new Error('Authentication required before uploading files.'));
      return;
    }

    xhr.open('POST', '/api/upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        unauthorizedHandler?.();
      }
      let parsed: { attachment?: AttachmentMeta; error?: string } = {};
      try {
        parsed = JSON.parse(xhr.responseText || '{}');
      } catch {
        // ignore JSON parse failure
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed.attachment) {
        onProgress(100);
        resolve(parsed.attachment);
      } else {
        reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading file. Please try again.'));
    };

    xhr.onabort = () => {
      reject(new Error('Upload cancelled.'));
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });

  return {
    promise,
    abort: () => xhr.abort(),
  };
}
