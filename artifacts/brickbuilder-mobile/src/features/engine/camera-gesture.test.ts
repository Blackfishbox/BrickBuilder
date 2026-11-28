import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { cameraGesture, type GestureStart, type PointerPoint } from "./camera-gesture";
import { CAMERA_GESTURE_GUIDE, GESTURE_GUIDE_SECTIONS, HELP_BUTTON_SECTIONS } from "./gesture-guide";
import { CONTROL_SYMBOLS } from "./control-symbols";
import { catalogs, type Locale } from "@/i18n/messages";

const points = [{ x: 100, y: 150 }, { x: 300, y: 150 }] as const;
const shift = (dx: number, dy: number): [PointerPoint, PointerPoint] =>
  points.map(p => ({ x: p.x + dx, y: p.y + dy })) as [PointerPoint, PointerPoint];
function baseline(theta = 0.72, phi = 0.93, distance = 17): GestureStart {
  return { points, camera: { theta, phi, distance, target: new Vector3(1, 2, 3) } };
}
const viewport = { width: 400, height: 800, fov: 42 };

describe("camera fitting help", () => {
  it("documents the fit-model control with its actual icon and label in both locales", () => {
    const workspace = HELP_BUTTON_SECTIONS.find(section => section.title === "help.section.workspace")!;
    const fitButton = workspace.buttons.find(button => button.title === "canvas.fitModel");

    expect(fitButton).toEqual({
      icon: CONTROL_SYMBOLS.fitModel,
      title: "canvas.fitModel",
      description: "help.button.fitModel.description",
    });
    expect(catalogs.en["canvas.fitModel"]).toBe("Fit model in view");
    expect(catalogs.en["help.button.fitModel.description"]).toContain("whole model");
    expect(catalogs.de["canvas.fitModel"]).toBe("Modell einpassen");
    expect(catalogs.de["help.button.fitModel.description"]).toContain("gesamte Modell");
  });
});

describe("camera gesture help contract", () => {
  it("lists the pan, pinch, and twist actions that the camera supports", () => {
    expect(CAMERA_GESTURE_GUIDE.map(({ behavior, title, description }) => ({ behavior, title, description }))).toEqual([
      { behavior: "pan", title: "gesture.camera.pan.title", description: "gesture.camera.pan.description" },
      { behavior: "pinch", title: "gesture.camera.pinch.title", description: "gesture.camera.pinch.description" },
      { behavior: "twist", title: "gesture.camera.twist.title", description: "gesture.camera.twist.description" },
    ]);
    expect(GESTURE_GUIDE_SECTIONS[0].gestures).toBe(CAMERA_GESTURE_GUIDE);
  });

  it.each([
    ["en", [
      ["Move two fingers together", "Move both fingers in the same direction to pan the camera."],
      ["Pinch", "Spread two fingers to zoom in; bring them together to zoom out."],
      ["Twist", "Rotate two fingers around each other to orbit around the model."],
    ]],
    ["de", [
      ["Zwei Finger gemeinsam bewegen", "Bewege beide Finger in dieselbe Richtung, um die Kamera zu verschieben."],
      ["Pinch-Geste", "Finger auseinanderziehen zoomt hinein; zusammenziehen zoomt heraus."],
      ["Zwei Finger drehen", "Drehe beide Finger umeinander, um die Kamera um das Modell zu drehen."],
    ]],
  ] as const)("keeps %s camera gesture help accurate", (locale: Locale, expectedCopy) => {
    expect(CAMERA_GESTURE_GUIDE.map(({ title, description }) => [
      catalogs[locale][title],
      catalogs[locale][description],
    ])).toEqual(expectedCopy);
  });

  it.each([
    ["en", [
      ["Drag with one finger", "Drag anywhere on the canvas to orbit the camera. A long press does not select a part."],
      ["Double-tap empty space", "Zoom in by 2×. This works only when no menu is open."],
      ["Double-tap a part", "It behaves like a quick tap: with part-tap selection on, the part is selected and the app switches to Select; with it off, nothing happens. It never opens rotation controls."],
      ["Drag empty space", "Orbit the camera without moving a part."],
      ["Double-tap empty space", "Zoom in by 2× when no menu is open."],
      ["Double-tap a part", "Open the rotation and tilt controls for that part."],
      ["Double-tap empty space", "Place one part; the same automatic mode choice applies."],
      ["Double-tap an existing part", "It is treated as one regular Build tap and placement; it does not open rotation controls."],
      ["Double-tap a part", "It is treated as one regular delete tap; it does not open rotation controls."],
      ["Drag empty space", "Orbit the camera without deleting a part."],
    ]],
    ["de", [
      ["Mit einem Finger ziehen", "Ziehe auf der Arbeitsfläche, um die Kamera zu drehen. Langes Drücken wählt keinen Stein aus."],
      ["Doppeltipp auf freie Fläche", "Zoomt um den Faktor 2 hinein. Funktioniert nur, wenn kein Menü geöffnet ist."],
      ["Doppeltipp auf einen Stein", "Wie ein kurzer Tipp: Bei aktiver Tipp-Auswahl wird der Stein ausgewählt und zur Auswahl gewechselt; bei deaktivierter Tipp-Auswahl passiert nichts. Das Drehmenü öffnet sich nicht."],
      ["Freie Fläche ziehen", "Dreht die Kamera, ohne einen Stein zu bewegen."],
      ["Doppeltipp auf freie Fläche", "Zoomt um den Faktor 2 hinein, wenn kein Menü geöffnet ist."],
      ["Doppeltipp auf einen Stein", "Öffnet die Dreh- und Neigungssteuerung für diesen Stein."],
      ["Doppeltipp auf freie Fläche", "Platziert einen Stein; danach gilt dieselbe automatische Moduswahl."],
      ["Doppeltipp auf einen vorhandenen Stein", "Wird wie ein normaler Tipp im Baumodus behandelt und platziert einen Stein; das Drehmenü öffnet sich nicht."],
      ["Doppeltipp auf einen Stein", "Wird wie ein normaler Lösch-Tipp behandelt; das Drehmenü öffnet sich nicht."],
      ["Freie Fläche ziehen", "Dreht die Kamera, ohne einen Stein zu löschen."],
    ]],
  ] as const)("keeps %s one-finger orbit and double-tap help aligned with touch handling", (locale: Locale, expectedCopy) => {
    const guidedTouchActions = [
      "gesture.view.orbit.title",
      "gesture.view.zoom.title",
      "gesture.view.doubleTapPart.title",
      "gesture.select.camera.title",
      "gesture.select.zoom.title",
      "gesture.select.rotate.title",
      "gesture.build.doubleTap.title",
      "gesture.build.doubleTapPart.title",
      "gesture.delete.doubleTap.title",
      "gesture.delete.camera.title",
    ] as const;
    const guideByTitle = new Map(
      GESTURE_GUIDE_SECTIONS.flatMap(section => section.gestures).map(line => [line.title, line]),
    );
    expect(guidedTouchActions.map(title => {
      const line = guideByTitle.get(title);
      expect(line, `missing guide entry ${title}`).toBeDefined();
      return [catalogs[locale][title], catalogs[locale][line!.description]];
    })).toEqual(expectedCopy);
  });

  it.each(CAMERA_GESTURE_GUIDE)("matches the documented $behavior gesture to camera behavior", ({ behavior }) => {
    const start = baseline();
    const endPoints: Record<typeof behavior, [PointerPoint, PointerPoint]> = {
      pan: shift(24, 18),
      pinch: [{ x: 70, y: 150 }, { x: 330, y: 150 }],
      twist: [
        { x: 200 - 100 * Math.cos(0.5), y: 150 - 100 * Math.sin(0.5) },
        { x: 200 + 100 * Math.cos(0.5), y: 150 + 100 * Math.sin(0.5) },
      ],
    };
    const next = cameraGesture(start, endPoints[behavior], viewport);

    if (behavior === "pan") {
      expect(next.target).not.toEqual(start.camera.target);
      expect(next.distance).toBe(start.camera.distance);
      expect(next.theta).toBe(start.camera.theta);
    } else if (behavior === "pinch") {
      expect(next.distance).toBeLessThan(start.camera.distance);
      expect(next.target).toEqual(start.camera.target);
      expect(next.theta).toBe(start.camera.theta);
      const bringTogether = cameraGesture(start, [{ x: 130, y: 150 }, { x: 270, y: 150 }], viewport);
      expect(bringTogether.distance).toBeGreaterThan(start.camera.distance);
      expect(bringTogether.target).toEqual(start.camera.target);
      expect(bringTogether.theta).toBe(start.camera.theta);
    } else {
      expect(next.theta).toBeGreaterThan(start.camera.theta);
      expect(next.target).toEqual(start.camera.target);
      expect(next.distance).toBe(start.camera.distance);
    }
  });
});

describe("independent two-finger camera gestures", () => {
  for (const [width, height] of [[400, 800], [800, 400], [600, 600]]) {
    for (const theta of [0, 0.72, Math.PI / 2, -2.4]) {
      for (const phi of [0.25, 0.93, 1.42]) {
        for (const distance of [3, 17, 800]) {
          it(`uses original horizontal and reversed vertical pan at ${width}x${height}, ${theta}/${phi}/${distance}`, () => {
            const start = baseline(theta, phi, distance);
            const camera = new PerspectiveCamera(42, width / height, 0.1, 4000);
            camera.position.copy(start.camera.target).add(new Vector3(
              distance * Math.sin(phi) * Math.sin(theta), distance * Math.cos(phi),
              distance * Math.sin(phi) * Math.cos(theta)));
            camera.lookAt(start.camera.target); camera.updateMatrixWorld(true);
            const origin = start.camera.target.clone().project(camera);
            for (const [dx, dy] of [[30, 0], [-30, 0], [0, 40], [0, -40], [30, 40], [-30, -40]]) {
              const next = cameraGesture(start, shift(dx, dy), { width, height, fov: 42 });
              expect(next.theta).toBe(theta); expect(next.phi).toBe(phi); expect(next.distance).toBe(distance);
              const projected = next.target.clone().project(camera).sub(origin);
              expect(projected.x * width / 2).toBeCloseTo(-dx);
              expect(projected.y * height / 2).toBeCloseTo(dy);
              expect(projected.z).toBeCloseTo(0);
              if (dy > 0) expect(next.target.y).toBeGreaterThan(start.camera.target.y);
              if (dy < 0) expect(next.target.y).toBeLessThan(start.camera.target.y);
            }
            expect(start.camera.target.toArray()).toEqual([1, 2, 3]);
          });
        }
      }
    }
  }
  it("zooms only with span and leaves the target and orbit untouched", () => {
    const start = baseline();
    const next = cameraGesture(start, [{ x: 0, y: 150 }, { x: 400, y: 150 }], viewport);
    expect(next.distance).toBe(8.5);
    expect(next.theta).toBe(start.camera.theta);
    expect(next.phi).toBe(start.camera.phi);
    expect(next.target).toEqual(start.camera.target);
  });
  it("ignores small angular noise and introduces twist continuously", () => {
    const start = baseline();
    const rotate = (angle: number): [PointerPoint, PointerPoint] => [
      { x: 200 - 100 * Math.cos(angle), y: 150 - 100 * Math.sin(angle) },
      { x: 200 + 100 * Math.cos(angle), y: 150 + 100 * Math.sin(angle) },
    ];
    expect(cameraGesture(start, rotate(0.04), viewport).theta).toBe(start.camera.theta);
    expect(cameraGesture(start, rotate(0.060001), viewport).theta).toBeCloseTo(start.camera.theta + 0.000001);
    const next = cameraGesture(start, rotate(0.5), viewport);
    expect(next.theta).toBeCloseTo(start.camera.theta + 0.44);
    expect(next.distance).toBeCloseTo(17);
    expect(next.target).toEqual(start.camera.target);
  });
  it("combines pan, pinch and twist without mixing their inputs", () => {
    const start = baseline(), angle = -0.4;
    const moved: [PointerPoint, PointerPoint] = [-1, 1].map(sign => ({
      x: 230 + sign * 150 * Math.cos(angle), y: 190 + sign * 150 * Math.sin(angle),
    })) as [PointerPoint, PointerPoint];
    const next = cameraGesture(start, moved, viewport);
    expect(next.theta).toBeCloseTo(start.camera.theta - 0.34);
    expect(next.distance).toBeCloseTo(17 * 2 / 3);
    expect(next.target.distanceTo(cameraGesture(start, shift(30, 40), viewport).target)).toBeLessThan(1e-12);
  });
  it("wraps angle differences across the negative X axis", () => {
    const start = baseline();
    start.points = [{ x: 300, y: 149 }, { x: 100, y: 151 }];
    expect(cameraGesture(start, [{ x: 300, y: 151 }, { x: 100, y: 149 }], viewport).theta).toBe(start.camera.theta);
  });
  it("keeps coincident fingers and zero-sized viewports finite", () => {
    const start = baseline(); start.points = [{ x: 1, y: 1 }, { x: 1, y: 1 }];
    const next = cameraGesture(start, [{ x: 1, y: 1 }, { x: 1, y: 1 }], { width: 0, height: 0, fov: 42 });
    expect(next).toEqual(start.camera);
  });
});
