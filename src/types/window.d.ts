import type { WikiAPI } from '../../shared/types';
declare global { interface Window { wiki: WikiAPI & { handleCloseReady(): Promise<void> } } }
export {};
