import { useCallback, useState } from "react";

import { useEscapeKey } from "./useEscapeKey";

export type EditorDialogsApi = {
  isResetDialogOpen: boolean;
  isSettingsDialogOpen: boolean;
  isChangelogDialogOpen: boolean;
  isHotkeysDialogOpen: boolean;
  /** True while any of the four dialogs is open; tool hotkeys are ignored then. */
  anyDialogOpen: boolean;
  openResetDialog: () => void;
  closeResetDialog: () => void;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
  openChangelogDialog: () => void;
  closeChangelogDialog: () => void;
  openHotkeysDialog: () => void;
  closeHotkeysDialog: () => void;
};

/**
 * Open/closed state for the editor's reset, settings, changelog and hotkeys
 * dialogs. Escape closes whichever is open. The save dialog belongs to
 * `usePixelExport`.
 */
export function useEditorDialogs(): EditorDialogsApi {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isChangelogDialogOpen, setIsChangelogDialogOpen] = useState(false);
  const [isHotkeysDialogOpen, setIsHotkeysDialogOpen] = useState(false);

  const openResetDialog = useCallback(() => {
    setIsResetDialogOpen(true);
  }, []);

  const closeResetDialog = useCallback(() => {
    setIsResetDialogOpen(false);
  }, []);

  const openSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(true);
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
  }, []);

  const openChangelogDialog = useCallback(() => {
    setIsChangelogDialogOpen(true);
  }, []);

  const closeChangelogDialog = useCallback(() => {
    setIsChangelogDialogOpen(false);
  }, []);

  const openHotkeysDialog = useCallback(() => {
    setIsHotkeysDialogOpen(true);
  }, []);

  const closeHotkeysDialog = useCallback(() => {
    setIsHotkeysDialogOpen(false);
  }, []);

  useEscapeKey(isResetDialogOpen, closeResetDialog);
  useEscapeKey(isSettingsDialogOpen, closeSettingsDialog);
  useEscapeKey(isChangelogDialogOpen, closeChangelogDialog);
  useEscapeKey(isHotkeysDialogOpen, closeHotkeysDialog);

  return {
    isResetDialogOpen,
    isSettingsDialogOpen,
    isChangelogDialogOpen,
    isHotkeysDialogOpen,
    anyDialogOpen:
      isResetDialogOpen || isSettingsDialogOpen || isChangelogDialogOpen || isHotkeysDialogOpen,
    openResetDialog,
    closeResetDialog,
    openSettingsDialog,
    closeSettingsDialog,
    openChangelogDialog,
    closeChangelogDialog,
    openHotkeysDialog,
    closeHotkeysDialog,
  };
}
