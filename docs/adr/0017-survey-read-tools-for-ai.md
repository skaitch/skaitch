# AI tools read the survey through two dedicated read-only tools

The AI (chat and MCP server) must be able to use what was captured on site: survey reliability, measure sources, closure checks, photos and their notes and photo cotes. Two read tools are added beside the existing ones, with no extra permission:

- `get_survey(storey_id)`: structured summary of the storey's survey level — rooms, walls (face length, source, thickness and its status), openings, links, closure checks, warnings, the survey reliability of produced elements (ADR 0016), and for each photo its surface and annotations as text (notes, photo cotes with value and source). No image data.
- `get_survey_photo(photo_id)`: the photo as an image for multimodal models, with its annotations (relative positions 0–1, text, values).

Both are read-only: the survey stays the source of truth and is never edited by the AI. `get_element_properties` stops returning the raw survey and base64 photos; it returns the element's survey reliability and the ids of its photos.

## Considered Options

- Enriching `get_element_properties` only: heavy answers, and no view of the survey as a whole.
- Reliability only, through the IFC Pset: photos, notes and photo cotes stay out of the AI's reach.
- Letting the AI edit the survey: rejected; measurements come from site, a model must not change them silently.
