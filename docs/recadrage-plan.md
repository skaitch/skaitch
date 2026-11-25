# Cropping the background plan at import

## Validated decisions

An image may contain the plans of several storeys. When importing a background plan, a preview lets the user select a single rectangular part for the current storey. The selected part becomes the background plan image and is calibrated with the existing tool, like a new image.

Cropping is final: changing the part requires importing the image again. No original is kept for a later change of the crop.

## Behaviour

The user adjusts the rectangle in the preview, then clicks "Use this part". Cancel keeps the existing background plan. An initial rectangle covering the whole image allows keeping an image that is already well framed.

As in the current import, the new background plan uses the initial position, rotation, opacity and scale values; the previous calibration is not reused. Building elements stay in place.

## Technical scope

The current import lives in PropertiesPane, in the storey properties. It reads the whole image, then replaces geom.plan with its dimensions and the default values. Cropping must happen before that replacement, so that the 2D plan, 3D and the AI tools all receive the same cropped image. Handle read and decode errors, validate a non-empty selection, and support mouse, touch and keyboard interactions.

## Usage

In a storey's properties, use "Upload" or "Change" in the background plan. Draw a rectangle on the preview, move the selection, adjust the corners or type the coordinates and dimensions in pixels. Arrow keys move the selection; Shift + arrows resize it. "Whole image" resets the selection.

"Use this part" saves a PNG image at the resolution of the selected pixels. Cancel, Escape or a decode error keep the existing background. The same cropped image is used in 2D, in 3D and by the assistant; the original stays in memory only while cropping.

Status: implemented. Automated tests on bounds, selection directions, dimensions and pixel extraction; TypeScript compilation and production build checked.
