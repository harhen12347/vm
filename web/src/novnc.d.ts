declare module '@novnc/novnc' {
  export interface DisconnectDetail {
    clean: boolean;
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string);
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    qualityLevel: number;
    compressionLevel: number;
    clipboardPasteFrom(text: string): void;
    sendCtrlAltDel(): void;
    disconnect(): void;
    addEventListener(
      type: 'connect' | 'disconnect',
      listener: (event: Event & { detail?: DisconnectDetail }) => void
    ): void;
  }
}
