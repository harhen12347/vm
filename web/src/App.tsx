import { useCallback, useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { loadPreferences, savePreferences } from './preferences';

interface DownloadProgress {
  received: number;
  total: number;
  percent: number;
}

function vmRequest<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Aether-VM-Token', token);
  return request<T>(url, { ...init, headers });
}

interface VmStatus {
  supportedPlatform: boolean;
  consoleAvailable: boolean;
  qemuInstalled: boolean;
  isoPresent: boolean;
  diskPresent: boolean;
  running: boolean;
  downloading: boolean;
  downloadProgress: DownloadProgress | null;
  accelerator: string;
  websocketPath: string;
  csrfToken: string;
  lastError: string | null;
}

interface SharedFile {
  name: string;
  size: number;
  modifiedAt: string;
}

interface ApiError {
  error?: string;
}

const EMPTY_STATUS: VmStatus = {
  supportedPlatform: false,
  consoleAvailable: false,
  qemuInstalled: false,
  isoPresent: false,
  diskPresent: false,
  running: false,
  downloading: false,
  downloadProgress: null,
  accelerator: 'Checking acceleration',
  websocketPath: '/vm-ws',
  csrfToken: '',
  lastError: null
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'error' in result
      ? String((result as ApiError).error)
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return result as T;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${bytes} B`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function App() {
  const [status, setStatus] = useState<VmStatus>(EMPTY_STATUS);
  const [csrfToken, setCsrfToken] = useState('');
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [scaleViewport, setScaleViewport] = useState(true);
  const [connection, setConnection] = useState('VM is not running');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const consoleElement = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await request<VmStatus>('/api/vm/status');
    setStatus(next);
    setCsrfToken(next.csrfToken);
    if (next.running) setConnection((current) => current === 'VM is not running' ? 'Connecting to guest…' : current);
    else setConnection('VM is not running');
    return next;
  }, []);

  const refreshSharedFiles = useCallback(async () => {
    setSharedFiles(await request<SharedFile[]>('/api/vm/shared'));
  }, []);

  useEffect(() => {
    void Promise.all([refreshStatus(), refreshSharedFiles()])
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load VM status.'));
    void loadPreferences()
      .then((preferences) => setScaleViewport(preferences.scaleViewport))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load browser preferences.'));
    const interval = window.setInterval(() => {
      void refreshStatus().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not refresh VM status.');
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [refreshSharedFiles, refreshStatus]);

  useEffect(() => {
    if (!status.running || !consoleElement.current) return;

    let disposed = false;
    let retryTimer = 0;
    let attempt = 0;
    const connect = () => {
      if (disposed || !consoleElement.current) return;
      if (attempt >= 20) {
        setConnection('Could not connect to the guest display');
        return;
      }
      attempt += 1;
      setConnection('Connecting to guest display…');
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const rfb = new RFB(
        consoleElement.current,
        `${scheme}//${window.location.host}${status.websocketPath}?token=${encodeURIComponent(csrfToken)}`
      );
      rfb.scaleViewport = scaleViewport;
      rfb.resizeSession = true;
      rfbRef.current = rfb;
      rfb.addEventListener('connect', () => {
        if (!disposed) setConnection('Connected to Ubuntu');
      });
      rfb.addEventListener('disconnect', (event) => {
        if (rfbRef.current === rfb) rfbRef.current = null;
        if (disposed) return;
        const detail = (event as Event & { detail?: { clean?: boolean } }).detail;
        if (detail?.clean) {
          setConnection('Guest display disconnected');
          return;
        }
        setConnection(`Reconnecting to guest display (${attempt}/20)…`);
        retryTimer = window.setTimeout(connect, Math.min(500 + attempt * 250, 3000));
      });
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      rfbRef.current?.disconnect();
      rfbRef.current = null;
    };
  }, [csrfToken, scaleViewport, status.running, status.websocketPath]);

  const startVm = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await vmRequest<VmStatus>('/api/vm/start', csrfToken, { method: 'POST' });
      setStatus(next);
      setCsrfToken(next.csrfToken);
      setConnection('Connecting to guest display…');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the VM.');
    } finally {
      setBusy(false);
    }
  };

  const downloadInstaller = async () => {
    setBusy(true);
    setError('');
    try {
      await vmRequest<VmStatus>('/api/vm/download', csrfToken, { method: 'POST' });
      await refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download Ubuntu.');
    } finally {
      setBusy(false);
    }
  };

  const shutdownVm = async () => {
    setBusy(true);
    setError('');
    try {
      await vmRequest<{ ok: boolean }>('/api/vm/shutdown', csrfToken, { method: 'POST' });
      setConnection('Ubuntu is shutting down…');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not shut down the VM.');
    } finally {
      setBusy(false);
    }
  };

  const updateScale = async (value: boolean) => {
    setScaleViewport(value);
    try {
      await savePreferences({ scaleViewport: value });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save display preference.');
    }
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/vm/shared/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Aether-VM-Token': csrfToken
        },
        body: file
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof result === 'object' && result !== null && 'error' in result
          ? String((result as ApiError).error)
          : `Upload failed (${response.status}).`;
        throw new Error(message);
      }
      await refreshSharedFiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload this file.');
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = async (name: string) => {
    setError('');
    try {
      const response = await fetch(`/api/vm/shared/download?name=${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download this file.');
    }
  };

  const deleteFile = async (name: string) => {
    setError('');
    try {
      await vmRequest<{ ok: boolean }>('/api/vm/shared/delete', csrfToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      await refreshSharedFiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this file.');
    }
  };

  const sendClipboard = () => {
    if (!clipboardText) return;
    rfbRef.current?.clipboardPasteFrom(clipboardText);
    setClipboardText('');
  };

  const downloadPercent = status.downloadProgress?.percent ?? 0;

  return (
    <div className="flex h-full flex-col text-slate-100">
      <header className="z-10 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#151b29]/95 px-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-lg font-bold shadow-lg">A</div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide">Aether Browser VM</h1>
            <p className="text-[10px] text-slate-400">Ubuntu Desktop · QEMU · noVNC</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`hidden rounded-full border px-3 py-1 text-[11px] sm:inline-flex ${status.running ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-400'}`}>
            <span className={`mr-2 mt-1 size-1.5 rounded-full ${status.running ? 'bg-emerald-300' : 'bg-slate-500'}`} />
            {status.running ? connection : status.downloading ? 'Downloading Ubuntu' : 'VM stopped'}
          </span>
          {status.running ? (
            <button onClick={shutdownVm} disabled={busy} className="rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100 hover:bg-red-400/20">
              Shut down
            </button>
          ) : null}
        </div>
      </header>

      {status.running ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="flex min-h-0 min-w-0 flex-col">
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#111725] px-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-400" />
                <span className="truncate text-xs text-slate-300">{connection}</span>
                <span className="hidden text-[10px] text-slate-500 sm:inline">· {status.accelerator}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => updateScale(!scaleViewport)} className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10">
                  {scaleViewport ? 'Fit display: on' : 'Fit display: off'}
                </button>
                <button onClick={() => rfbRef.current?.sendCtrlAltDel()} className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10">
                  Ctrl+Alt+Del
                </button>
              </div>
            </div>
            <div ref={consoleElement} className="vnc-view flex-1" aria-label="Live Ubuntu virtual machine console" />
          </section>

          <aside className="vm-scrollbar flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-white/10 bg-[#151b29] p-4 lg:border-l lg:border-t-0">
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Files shared with host</h2>
              <p className="mt-2 text-[10px] leading-5 text-slate-400">
                Upload or download files from this browser. In Ubuntu, mount the share in Terminal:
                <code className="mt-2 block rounded-md bg-black/30 p-2 text-[10px] text-indigo-200">sudo mkdir -p /mnt/host<br />sudo mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host</code>
              </p>
              <label className="mt-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-indigo-300/30 bg-indigo-400/5 px-3 py-3 text-xs text-indigo-100 hover:bg-indigo-400/10">
                Upload from computer
                <input className="sr-only" type="file" disabled={busy} onChange={(event) => {
                  void uploadFile(event.target.files?.[0]);
                  event.target.value = '';
                }} />
              </label>
              <p className="mt-1 text-center text-[9px] text-slate-500">Files up to 128 MB · guest path /mnt/host</p>
              <ul className="mt-3 space-y-2">
                {sharedFiles.map((file) => (
                  <li key={file.name} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] p-2">
                    <span className="min-w-0 flex-1 truncate text-[10px]" title={file.name}>{file.name}</span>
                    <span className="shrink-0 text-[9px] text-slate-500">{formatBytes(file.size)}</span>
                    <button aria-label={`Download ${file.name}`} onClick={() => void downloadFile(file.name)} className="text-[10px] text-indigo-200 hover:text-white">↓</button>
                    <button aria-label={`Delete ${file.name}`} onClick={() => void deleteFile(file.name)} className="text-[10px] text-slate-500 hover:text-red-200">×</button>
                  </li>
                ))}
                {sharedFiles.length === 0 ? <li className="py-2 text-[10px] text-slate-500">No shared files yet.</li> : null}
              </ul>
            </section>
            <section className="border-t border-white/10 pt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Clipboard to Ubuntu</h2>
              <div className="mt-2 flex gap-2">
                <input value={clipboardText} onChange={(event) => setClipboardText(event.target.value)} onKeyDown={(event) => {
                  if (event.key === 'Enter') sendClipboard();
                }} placeholder="Paste text into guest…" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[10px] outline-none focus:border-indigo-300/50" />
                <button onClick={sendClipboard} className="rounded-lg bg-indigo-500/20 px-2 text-[10px] text-indigo-100 hover:bg-indigo-500/30">Paste</button>
              </div>
            </section>
            <p className="mt-auto text-[9px] leading-4 text-slate-500">Guest apps, browser history, downloads, and files persist on the VM disk. Use Ubuntu’s browser for genuine web browsing.</p>
          </aside>
        </main>
      ) : (
        <main className="vm-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8">
          <section className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#171e2e]/90 p-6 shadow-2xl shadow-black/30 sm:p-10">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-orange-300 to-fuchsia-600 text-3xl shadow-xl">◉</div>
            <p className="text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-indigo-200">A real computer in your browser</p>
            <h2 className="mt-3 text-center text-2xl font-semibold tracking-tight sm:text-3xl">Ubuntu Desktop VM</h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-sm leading-6 text-slate-400">
              A full Ubuntu operating system runs in an isolated QEMU virtual machine. Its real desktop and Firefox browser stream into this page using noVNC.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
                <span className="block text-lg">▣</span><b className="mt-1 block text-[11px]">Real Linux desktop</b><span className="mt-1 block text-[9px] text-slate-500">Persistent virtual disk</span>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
                <span className="block text-lg">◎</span><b className="mt-1 block text-[11px]">Real Firefox browser</b><span className="mt-1 block text-[9px] text-slate-500">Google and normal websites</span>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-center">
                <span className="block text-lg">⇧</span><b className="mt-1 block text-[11px]">Host file sharing</b><span className="mt-1 block text-[9px] text-slate-500">Upload and download</span>
              </div>
            </div>

            <div className="mt-7 rounded-xl border border-white/10 bg-black/15 p-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-300">Ubuntu 24.04.5 Desktop installer</span>
                <span className="shrink-0 text-slate-500">{status.isoPresent ? 'Verified and ready' : '6.25 GB download'}</span>
              </div>
              {status.downloading || status.downloadProgress ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all" style={{ width: `${downloadPercent}%` }} />
                </div>
              ) : null}
              {status.downloading ? <p className="mt-2 text-[10px] text-slate-400">{formatBytes(status.downloadProgress?.received ?? 0)} of {formatBytes(status.downloadProgress?.total ?? 0)}</p> : null}
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                {!status.isoPresent ? (
                  <button disabled={busy || status.downloading || !status.supportedPlatform} onClick={() => void downloadInstaller()} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-medium hover:bg-white/10">
                    {status.downloading ? 'Downloading…' : 'Download official Ubuntu ISO'}
                  </button>
                ) : null}
                <button disabled={busy || !status.supportedPlatform || !status.qemuInstalled || !status.isoPresent} onClick={() => void startVm()} className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-xs font-semibold shadow-lg shadow-indigo-950/50 hover:brightness-110">
                  {status.diskPresent ? 'Start Ubuntu VM' : 'Boot installer'}
                </button>
              </div>
            </div>

            {!status.supportedPlatform ? (
              <p className="mt-4 rounded-lg border border-red-300/20 bg-red-400/5 p-3 text-center text-xs text-red-100">
                The VM backend currently requires a Linux host with QEMU installed.
              </p>
            ) : !status.qemuInstalled ? (
              <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-center text-xs text-amber-100">
                Install the host dependency: <code>sudo apt install qemu-system-x86 qemu-utils</code>
              </p>
            ) : null}

            <div className="mt-6 space-y-2 text-[10px] leading-5 text-slate-500">
              <p><b className="text-slate-300">First run:</b> the installer boots in the streamed display. Install Ubuntu onto its 32 GB virtual disk. It uses 4 GB RAM and 2 CPU cores.</p>
              <p><b className="text-slate-300">After setup:</b> remove the installer ISO from the boot order if prompted, then restart. Your guest files and apps persist on the VM disk.</p>
              <p><b className="text-slate-300">Internet:</b> the guest uses QEMU NAT. The VNC console is only reachable through this local app server.</p>
            </div>
          </section>
        </main>
      )}

      {error || status.lastError ? (
        <div role="alert" className="absolute bottom-4 left-1/2 z-20 w-[min(90vw,640px)] -translate-x-1/2 rounded-xl border border-red-300/20 bg-[#321f2a] px-4 py-3 text-xs text-red-100 shadow-xl">
          {error || status.lastError}
          <button onClick={() => setError('')} aria-label="Dismiss error" className="float-right ml-4 text-red-200">×</button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
