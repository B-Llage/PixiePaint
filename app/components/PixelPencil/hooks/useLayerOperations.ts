import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { createBuffer, type PixelBuffer } from "../pixel-buffer";
import type { Layer } from "../PixelPencilTypes";
import { generateLayerName } from "../pixel-operations";

export const createLayerId = () =>
  `layer-${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36)}`;

export type LayerOperationsOptions = {
  gridWidth: number;
  gridHeight: number;
  layersRef: RefObject<Layer[]>;
  setLayers: (next: SetStateAction<Layer[]>) => Layer[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  setPathPreview: Dispatch<SetStateAction<Set<number> | null>>;
  setHoverIndexIfChanged: (next: number | null) => void;
  /**
   * Records a one-shot layer-list change. `apply` performs it and returns the buffers it removed
   * or replaced, keyed by layer id; ends any pixel action in progress.
   */
  recordStructureChange: (apply: () => Map<string, PixelBuffer> | void) => void;
};

export type LayerOperationsApi = {
  /** Appends an empty, visible layer with the next free name and makes it active. */
  createLayer: () => void;
  /** Removes a layer unless it is the last one; the topmost remaining layer becomes active if needed. */
  deleteLayer: (layerId: string) => void;
  /** Renames a layer to the trimmed name when it is non-empty and different. */
  renameLayer: (layerId: string, name: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  /** Moves the layer at `fromIndex` to `toIndex` (bottom to top order). */
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  /** Makes a layer active; does not record history. */
  selectLayer: (layerId: string) => void;
};

/**
 * The layer panel's operations. Each structural change runs inside one
 * `recordStructureChange` call; selecting a layer does not record history.
 * Deleting a layer hands its buffer to history so undo can bring it back.
 * Changes that move the active layer also drop the hover cell and any path
 * preview.
 */
export function useLayerOperations({
  gridWidth,
  gridHeight,
  layersRef,
  setLayers,
  activeLayerId,
  setActiveLayerId,
  setPathPreview,
  setHoverIndexIfChanged,
  recordStructureChange,
}: LayerOperationsOptions): LayerOperationsApi {
  const createLayer = useCallback(() => {
    recordStructureChange(() => {
      const newLayer: Layer = {
        id: createLayerId(),
        name: generateLayerName(layersRef.current),
        pixels: createBuffer(gridWidth, gridHeight),
        visible: true,
      };
      setLayers([...layersRef.current, newLayer]);
      setActiveLayerId(newLayer.id);
    });
    setPathPreview(null);
    setHoverIndexIfChanged(null);
  }, [gridHeight, gridWidth, layersRef, recordStructureChange, setActiveLayerId, setHoverIndexIfChanged, setLayers, setPathPreview]);

  const deleteLayer = useCallback(
    (layerId: string) => {
      const currentLayers = layersRef.current;
      if (currentLayers.length <= 1) {
        return;
      }
      const removedLayer = currentLayers.find((layer) => layer.id === layerId);
      if (!removedLayer) {
        return;
      }
      const nextLayers = currentLayers.filter((layer) => layer.id !== layerId);
      let nextActiveId = activeLayerId;
      if (
        layerId === activeLayerId ||
        !nextLayers.some((layer) => layer.id === activeLayerId)
      ) {
        nextActiveId = nextLayers[nextLayers.length - 1].id;
      }
      recordStructureChange(() => {
        setLayers(nextLayers);
        setActiveLayerId(nextActiveId);
        return new Map([[layerId, removedLayer.pixels]]);
      });
      setPathPreview(null);
      setHoverIndexIfChanged(null);
    },
    [activeLayerId, layersRef, recordStructureChange, setActiveLayerId, setHoverIndexIfChanged, setLayers, setPathPreview],
  );

  const renameLayer = useCallback(
    (layerId: string, name: string) => {
      const trimmedName = name.trim();
      const currentLayers = layersRef.current;
      const layer = currentLayers.find((item) => item.id === layerId);
      if (!layer || !trimmedName || layer.name === trimmedName) return;

      recordStructureChange(() => {
        setLayers(
          currentLayers.map((item) => (item.id === layerId ? { ...item, name: trimmedName } : item)),
        );
      });
    },
    [layersRef, recordStructureChange, setLayers],
  );

  const toggleLayerVisibility = useCallback(
    (layerId: string) => {
      if (!layersRef.current.some((layer) => layer.id === layerId)) {
        return;
      }
      recordStructureChange(() => {
        setLayers(
          layersRef.current.map((layer) =>
            layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
          ),
        );
      });
    },
    [layersRef, recordStructureChange, setLayers],
  );

  const reorderLayers = useCallback(
    (fromIndex: number, toIndex: number) => {
      const currentLayers = layersRef.current;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= currentLayers.length ||
        toIndex >= currentLayers.length
      ) {
        return;
      }
      recordStructureChange(() => {
        const nextLayers = [...currentLayers];
        const [moved] = nextLayers.splice(fromIndex, 1);
        nextLayers.splice(toIndex, 0, moved);
        setLayers(nextLayers);
      });
    },
    [layersRef, recordStructureChange, setLayers],
  );

  const selectLayer = useCallback(
    (layerId: string) => {
      if (layerId === activeLayerId) return;
      if (!layersRef.current.some((layer) => layer.id === layerId)) {
        return;
      }
      setActiveLayerId(layerId);
      setPathPreview(null);
      setHoverIndexIfChanged(null);
    },
    [activeLayerId, layersRef, setActiveLayerId, setHoverIndexIfChanged, setPathPreview],
  );

  return { createLayer, deleteLayer, renameLayer, toggleLayerVisibility, reorderLayers, selectLayer };
}
