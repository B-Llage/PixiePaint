import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PencilTool, BucketTool } from "./PixelPencilTools";
import { Toolbox } from "./Toolbox";

describe("Toolbox labels", () => {
  it("shows each label above its icon outside the scrolling toolbar on hover and focus", () => {
    render(
      <section aria-label="Tools" className="overflow-x-auto">
        <Toolbox tools={[PencilTool, BucketTool]} selectedToolId="pencil" onSelect={vi.fn()} />
      </section>,
    );

    const toolbar = screen.getByRole("region", { name: "Tools" });
    const pencil = within(toolbar).getByRole("button", { name: "Pencil" });
    const bucket = within(toolbar).getByRole("button", { name: "Bucket" });

    fireEvent.mouseEnter(pencil);
    let label = screen.getByRole("tooltip");
    expect(label.textContent).toBe("Pencil");
    expect(label.className).toContain("fixed");
    expect(toolbar.contains(label)).toBe(false);
    const arrow = label.querySelector('[aria-hidden="true"]');
    expect(arrow?.className).toContain("rotate-45");
    expect(arrow?.className).toContain("border-b");
    expect(arrow?.className).toContain("border-r");

    fireEvent.mouseLeave(pencil);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(bucket);
    label = screen.getByRole("tooltip");
    expect(label.textContent).toBe("Bucket");
    expect(bucket.getAttribute("aria-describedby")).toBe(label.id);

    fireEvent.scroll(toolbar);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
