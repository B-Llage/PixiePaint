import { useState } from "react";

export type ZoomMode = "in" | "out";

export function useZoomControls() {
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("in");

  return {
    zoomScale,
    setZoomScale,
    zoomMode,
    setZoomMode,
  };
}
