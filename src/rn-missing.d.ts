/**
 * Ambient type augmentations for React Native globals that exist at runtime
 * but are missing from RN's bundled TypeScript definitions.
 */

interface WebSocket {
  binaryType: 'blob' | 'arraybuffer';
}

interface Blob {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface FormData {
  append(name: string, value: any, filename?: string): void;
}

declare function atob(encoded: string): string;
declare function btoa(input: string): string;
