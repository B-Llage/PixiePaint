import { useState } from "react";
import type { MutableRefObject } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PixelValue } from "../../PixelPencilTypes";
import { SelectedColor } from "./SelectedColor";

function ColorHarness({
  initialColor,
  drawValueRef,
}: {
  initialColor: string;
  drawValueRef: MutableRefObject<PixelValue>;
}) {
  const [activeColor, setActiveColor] = useState(initialColor);

  return (
    <>
      <SelectedColor
        selectedColorStyles={{ backgroundColor: activeColor }}
        activeColor={activeColor}
        setActiveColor={setActiveColor}
        drawValueRef={drawValueRef}
      />
      <output data-testid="active-color">{activeColor}</output>
      <button type="button" onClick={() => {
        setActiveColor("#336699");
        drawValueRef.current = "#336699";
      }}>Select blue palette color</button>
    </>
  );
}

function renderColorHarness(initialColor = "#808000") {
  const drawValueRef: MutableRefObject<PixelValue> = { current: initialColor };
  render(<ColorHarness initialColor={initialColor} drawValueRef={drawValueRef} />);
  return drawValueRef;
}

function slider(name: string): HTMLInputElement {
  return screen.getByRole("slider", { name }) as HTMLInputElement;
}

function expectColor(color: string, drawValueRef: MutableRefObject<PixelValue>) {
  expect(screen.getByTestId("active-color").textContent).toBe(color);
  expect(drawValueRef.current).toBe(color);
  const expectedPreview = document.createElement("span");
  expectedPreview.style.backgroundColor = color;
  expect((screen.getByLabelText("Selected color preview") as HTMLElement).style.backgroundColor)
    .toBe(expectedPreview.style.backgroundColor);
}

describe("SelectedColor HSL sliders", () => {
  it("changes saturation without changing hue or lightness, then restores the color", () => {
    const drawValueRef = renderColorHarness();

    expect(slider("Hue").value).toBe("60");
    expect(slider("Saturation").value).toBe("100");
    expect(slider("Lightness").value).toBe("25");

    fireEvent.change(slider("Saturation"), { target: { value: "0" } });
    expectColor("#404040", drawValueRef);
    expect(slider("Hue").value).toBe("60");
    expect(slider("Lightness").value).toBe("25");

    fireEvent.change(slider("Saturation"), { target: { value: "100" } });
    expectColor("#808000", drawValueRef);

    fireEvent.change(slider("Lightness"), { target: { value: "50" } });
    expectColor("#ffff00", drawValueRef);
    expect(slider("Saturation").value).toBe("100");

    fireEvent.change(slider("Hue"), { target: { value: "240" } });
    expectColor("#0000ff", drawValueRef);
  });

  it("reads HSL from a newly selected palette color and restores color from black", () => {
    const drawValueRef = renderColorHarness("#000000");

    fireEvent.change(slider("Hue"), { target: { value: "120" } });
    expectColor("#00ff00", drawValueRef);

    fireEvent.click(screen.getByRole("button", { name: "Select blue palette color" }));
    expect(slider("Hue").value).toBe("210");
    expect(slider("Saturation").value).toBe("50");
    expect(slider("Lightness").value).toBe("40");

    fireEvent.change(slider("Lightness"), { target: { value: "100" } });
    expectColor("#ffffff", drawValueRef);
    fireEvent.change(slider("Lightness"), { target: { value: "40" } });
    expectColor("#336699", drawValueRef);
  });
});
