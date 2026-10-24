import { useState } from 'react';

/** Keep the same fixed-size tiles across home and conversation grids. */
export function useWatchTileSize() {
    const [size] = useState(() => Math.max(125, Math.round(Math.floor((window.screen.availWidth - 60 - 48 - 5 * 16) / 6) * 0.6)));
    return size;
}
