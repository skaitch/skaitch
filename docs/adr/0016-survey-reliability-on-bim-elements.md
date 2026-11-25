# BIM elements carry a summary survey reliability

Every wall, space, door and window produced by reconstruction carries one **survey reliability** level, so that whoever reads the model knows which geometry was measured on site and which was guessed. The per-value detail (source of each length, thickness status…) stays in the survey, which remains the source of truth.

Levels, by precedence: **Modified in skAItch** > **Assumed** > **Partly estimated** > **Measured**.

| Element | Measured when… | Assumed when… | Otherwise |
|---|---|---|---|
| Wall | length from `laser`, `tape` or `manual`, thickness measured, room resolved and placed without assumption | room geometry or placement assumed | Partly estimated |
| Space | shape resolved, placement not assumed, every wall measured, ceiling height typed (not the survey default) | geometry or placement assumed | Partly estimated |
| Door / window | width, height and offset typed, host wall measured | host wall assumed | Partly estimated |

`estimated` and `computed` sources and every survey default never count as measured. An element changed by hand since the last reconstruction (the same detection as reconstruction conflicts) becomes **Modified in skAItch**; a new accepted reconstruction recomputes its level.

The editor shows it as a line of the properties panel and through an optional **Reliability** view mode colouring survey elements (measured green, partly estimated orange, assumed red, modified grey) and dimming the rest; the normal plan and PDF sheets are unchanged. IFC export writes `Pset_skAItchSurvey` on spaces, walls, doors and windows (`Reliability`: Measured / PartlyEstimated / Assumed / ModifiedAfterSurvey, `SurveyName`, `SurveyDate`: when the survey was imported on the storey). IFC import keeps them as the element's `SurveyReliability`, `SurveyName` and `SurveyDate`; an element read this way shows its reliability but can no longer become "modified", having no survey to compare with. A survey revision number is not written: the storey does not keep which revision it was imported from.

## Considered Options

- Status per value (each length, thickness, height): most faithful, but heavy to show on a plan and in IFC; the survey already holds it.
- Survey tab only: the information disappears as soon as one works on the model.
- Keeping the survey level after a manual edit: the plan would show "Measured" on geometry that no longer is.
- Permanent marks on the plan: clutters drawing and printed sheets.
- Per-value properties in IFC: contradicts the summary choice.

## Consequences

- Photo annotations (notes, photo cotes), still reduced to a count on elements, are the next survey information to bring into the editor.

## Addendum — photo annotations in the editor

A wall's or space's photos open, from the properties panel, in a read-only viewer drawing their notes and photo cotes at their surveyed positions. Annotations are corrected in the Survey app only (no two-way synchronisation, ADR 0011). A camera mark on the plan may come later if needed.

## Addendum — a different survey on a storey

Importing again the same survey (same id, a new revision) only replaces the storey's survey; the next reconstruction updates, creates and deletes through the survey correlation. When the storey's survey is a different one (a survey started anew), the elements of the previous survey are no longer followed: the reconstruction asks before applying anything. By default the untouched ones are deleted as a group; those changed by hand are listed one by one and kept by default. A kept element becomes an ordinary element and is not asked about again. Matching them to the new survey by room and wall names was set aside: a guess that fails with two rooms of the same name.
