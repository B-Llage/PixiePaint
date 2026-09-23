"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type DragEvent,
} from "react";

interface LayersPanelProps {
  layers: Array<{ id: string; name: string; visible: boolean }>;
  activeLayerId: string;
  onSelectLayer: (id: string) => void;
  onCreateLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleVisibility: (id: string) => void;
  onReorderLayers: (fromIndex: number, toIndex: number) => void;
  layerPreviews: Record<string, string | undefined>;
}

export function LayersPanel({
  layers,
  activeLayerId,
  onSelectLayer,
  onCreateLayer,
  onDeleteLayer,
  onRenameLayer,
  onToggleVisibility,
  onReorderLayers,
  layerPreviews,
}: LayersPanelProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cancelRenameRef = useRef(false);
  const canDeleteLayer = layers.length > 1;

  useEffect(() => {
    if (editingLayerId) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingLayerId]);

  const commitRename = useCallback(() => {
    if (!editingLayerId || cancelRenameRef.current) return;
    const name = draftName.trim();
    const layer = layers.find((item) => item.id === editingLayerId);
    setEditingLayerId(null);
    if (layer && name && name !== layer.name) {
      onRenameLayer(editingLayerId, name);
    }
  }, [draftName, editingLayerId, layers, onRenameLayer]);

  const handleNameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRenameRef.current = true;
        setEditingLayerId(null);
      }
    },
    [commitRename],
  );

  const orderedLayers = useMemo(
    () => [...layers].reverse(),
    [layers],
  );

  const resolveIndex = useCallback(
    (id: string) => layers.findIndex((layer) => layer.id === id),
    [layers],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLLIElement>, id: string) => {
      if (editingLayerId === id) {
        event.preventDefault();
        return;
      }
      setDraggedId(id);
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.effectAllowed = "move";
    },
    [editingLayerId],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLLIElement>, id: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) {
      setDragOverId(id);
    }
  }, [dragOverId]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLLIElement>, id: string) => {
    event.preventDefault();
    if (dragOverId === id) {
      setDragOverId(null);
    }
  }, [dragOverId]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLIElement>, id: string) => {
      event.preventDefault();
      const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === id) {
        handleDragEnd();
        return;
      }
      const fromIndex = resolveIndex(sourceId);
      const toIndex = resolveIndex(id);
      if (fromIndex === -1 || toIndex === -1) {
        handleDragEnd();
        return;
      }
      onReorderLayers(fromIndex, toIndex);
      handleDragEnd();
    },
    [draggedId, handleDragEnd, onReorderLayers, resolveIndex],
  );

  const handleToggleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, id: string) => {
      event.stopPropagation();
      onToggleVisibility(id);
    },
    [onToggleVisibility],
  );

  const handleDeleteClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, id: string) => {
      event.stopPropagation();
      onDeleteLayer(id);
    },
    [onDeleteLayer],
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Layers
        </span>
        <button
          type="button"
          onClick={onCreateLayer}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
        >
          Add Layer
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {orderedLayers.map((layer) => {
        const isActive = layer.id === activeLayerId;
        const isDragged = layer.id === draggedId;
        const isDragOver = layer.id === dragOverId;
        const previewSrc = layerPreviews[layer.id];
        return (
          <li
            key={layer.id}
            draggable={editingLayerId !== layer.id}
            onDragStart={(event) => handleDragStart(event, layer.id)}
            onDragOver={(event) => handleDragOver(event, layer.id)}
            onDragLeave={(event) => handleDragLeave(event, layer.id)}
            onDrop={(event) => handleDrop(event, layer.id)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 rounded-md border px-2 py-2 text-sm transition-colors ${
              isActive
                ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800"
                : "border-zinc-200 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            } ${isDragged ? "opacity-60" : ""} ${
              isDragOver ? "ring-2 ring-black dark:ring-white" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectLayer(layer.id)}
              className="flex-shrink-0"
              aria-label={`Select ${layer.name}`}
            >
              <div
                className={`relative h-10 w-10 flex-shrink-0 overflow-hidden rounded border border-zinc-300 dark:border-zinc-600 ${layer.visible ? "" : "opacity-50"}`}
                style={{
                  backgroundImage:
                    "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db), linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db)",
                  backgroundSize: "8px 8px",
                  backgroundPosition: "0 0, 4px 4px",
                }}
                aria-hidden="true"
              >
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
            </button>
            {editingLayerId === layer.id ? (
              <input
                ref={nameInputRef}
                type="text"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={handleNameKeyDown}
                onBlur={commitRename}
                onDragStart={(event) => event.preventDefault()}
                className="min-w-0 flex-1 rounded border border-zinc-400 bg-white px-1 py-0.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-black dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-white"
                aria-label={`Rename ${layer.name}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelectLayer(layer.id)}
                onDoubleClick={() => {
                  cancelRenameRef.current = false;
                  setEditingLayerId(layer.id);
                  setDraftName(layer.name);
                }}
                className="min-w-0 flex-1 truncate text-left"
                title="Double-click to rename"
              >
                {layer.name}
              </button>
            )}
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(event) => handleToggleClick(event as unknown as MouseEvent<HTMLButtonElement>, layer.id)}
              className="h-4 w-4 rounded border border-zinc-400 text-zinc-600 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              aria-label={layer.visible ? "Hide layer" : "Show layer"}
            />
            <button
              type="button"
              onClick={(event) => handleDeleteClick(event, layer.id)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-red-400 dark:text-black dark:hover:bg-red-500 dark:focus-visible:ring-offset-black disabled:opacity-40"
              disabled={!canDeleteLayer}
              aria-label="Delete layer"
            >
              <span className="text-base leading-none">−</span>
            </button>
          </li>
        );
      })}
      </ul>
    </div>
  );
}
