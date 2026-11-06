import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEditorDialogs } from "./useEditorDialogs";

const DIALOGS = [
  { open: "openResetDialog", close: "closeResetDialog", flag: "isResetDialogOpen" },
  { open: "openSettingsDialog", close: "closeSettingsDialog", flag: "isSettingsDialogOpen" },
  { open: "openChangelogDialog", close: "closeChangelogDialog", flag: "isChangelogDialogOpen" },
  { open: "openHotkeysDialog", close: "closeHotkeysDialog", flag: "isHotkeysDialogOpen" },
] as const;

describe("useEditorDialogs", () => {
  it("starts with every dialog closed", () => {
    const { result } = renderHook(() => useEditorDialogs());
    for (const dialog of DIALOGS) {
      expect(result.current[dialog.flag]).toBe(false);
    }
    expect(result.current.anyDialogOpen).toBe(false);
  });

  it.each(DIALOGS)("opens and closes $flag and reports anyDialogOpen", (dialog) => {
    const { result } = renderHook(() => useEditorDialogs());
    act(() => result.current[dialog.open]());
    expect(result.current[dialog.flag]).toBe(true);
    expect(result.current.anyDialogOpen).toBe(true);
    for (const other of DIALOGS) {
      if (other !== dialog) expect(result.current[other.flag]).toBe(false);
    }

    act(() => result.current[dialog.close]());
    expect(result.current[dialog.flag]).toBe(false);
    expect(result.current.anyDialogOpen).toBe(false);
  });

  it("closes the open dialog on Escape and ignores Escape when nothing is open", () => {
    const { result } = renderHook(() => useEditorDialogs());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.anyDialogOpen).toBe(false);

    act(() => result.current.openSettingsDialog());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(result.current.isSettingsDialogOpen).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(result.current.isSettingsDialogOpen).toBe(false);
  });

  it("keeps stable handler identities across renders", () => {
    const { result, rerender } = renderHook(() => useEditorDialogs());
    const first = result.current;
    act(() => result.current.openHotkeysDialog());
    rerender();
    expect(result.current.openHotkeysDialog).toBe(first.openHotkeysDialog);
    expect(result.current.closeResetDialog).toBe(first.closeResetDialog);
  });
});
