# S-PYRO ingestion package format

Upload these files together at **Admin → Data ingestion** (`POST /api/admin/ingest`). One package = one investigation.
Use **Validate only** first: it checks every file and writes nothing. A working placeholder is in `docs/sample-package/`
(**format example only, not real data**).

| File | Required | Stored in |
|---|---|---|
| `investigation.json` | yes | `investigations`, `publications` |
| `experimental_conditions.json` | no | `experimental_conditions` |
| `scientific_findings.json` | no | `scientific_findings` |
| `experimental_data.csv` | no | `experimental_datasets`, `experimental_data` |
| `figures.json` + image files | no | `figures` + Storage `research-figures` |
| `methodology.md` | no | `investigations.methodology` + chunks (layer `extracted`) |
| `research_summary.md` | no | `investigations.research_summary` + chunks (layer `ai_interpretation`) |
| `references.json` | no | `investigations.references` |
| original `*.pdf` | no | Storage `research-documents` (byte-identical) + `research_chunks` (layer `original`, per page) |
| `fire_safety_applications.json` | no | `fire_safety_applications` |
| `mission_relevance.json` | no | `mission_relevance` |

## Evidence layers
1. **Original evidence** — the PDF, stored unchanged; its page text becomes `original` chunks.
2. **Structured extraction** — conditions, findings, figures, datasets, methodology.
3. **AI interpretation** — `research_summary.md`. Always labelled, never cited as evidence, excluded from text retrieval by default.

## investigation.json
```json
{
  "investigation_code": "ABC-001",            // required, unique key (re-upload updates the same investigation)
  "title": "…",                              // required
  "description": "…", "abstract": "…",
  "research_category": "…", "investigation_type": "flight experiment | ground-based | numerical | …",
  "combustion_phenomena": ["flame spread"], "keywords": ["…"], "objectives": ["…"],
  "limitations": ["limitation as stated by the source"],
  "publication": { "title": "…", "authors": ["…"], "publication_year": 2020, "doi": "10.…", "journal": "…",
                   "publication_type": "…", "source_url": "…", "abstract": "…", "file_name": "paper.pdf" }
}
```
Use `"publications": [ … ]` for several papers; set each `file_name` to match its PDF. In the other files, link a record to a
publication with `publication_doi` or `publication_title` (optional when there is only one publication).

## experimental_conditions.json — array
```json
{ "parameter": "Oxygen concentration", "value": "18", "unit": "%", "context": "Test 3, drop tower",
  "source_page": 8, "source_section": "Experimental setup", "source_table": "2", "source_figure": null }
```
`value` is kept as written (ranges like `"18-21"` are fine). S-PYRO also derives a canonical `parameter_key`, a normalised
value (oxygen %, pressure kPa, temperature K, gravity g) and a gravity class for filtering and comparison. Supported units:
Pa kPa MPa bar mbar atm psi torr · K °C °F · % vol% ppm fraction · g µg mg m/s² · m cm mm µm · s ms min h · m/s cm/s mm/s · W kW · W/m² kW/m² · kg.
Unknown units are stored as written but cannot be converted.

## scientific_findings.json — array
```json
{ "description": "text of the finding as reported", "evidence_type": "experimental_observation",
  "phenomenon": "flame spread", "reported_values": {"spread_rate": "…"},
  "source_page": 12, "source_section": "Results", "source_figure": "5", "source_table": null }
```
`evidence_type`: `experimental_observation`, `numerical_result`, `theoretical`, `author_interpretation`, `review`, `other`
(unknown values become `other` with a warning). Keep author interpretations marked as such — S-PYRO never presents them as observations.

## experimental_data.csv
Required columns: `dataset_name, variable, value`. Optional: `unit, experimental_condition, source_reference, row_index,
description, source_page, source_table, publication_doi`. `value` must be numeric (non-numeric rows are rejected). Variables
that belong to the same table row share a `row_index` (if omitted, rows are numbered per variable in file order). Re-uploading a
dataset replaces its rows.

## figures.json — array
`figure_number` (required), `caption`, `page_number`, `image_file` (name of an uploaded image), `x_axis`, `y_axis`, `units`,
`description`, `qualitative_observations`. Figures are **not digitised**; only described.

## fire_safety_applications.json — array (optional)
`application_category` (`fire_detection`, `smoke_monitoring`, `fire_suppression`, `fine_water_mist`, `material_flammability`,
`oxygen_management`, `ventilation`, `fire_resistant_materials`, `protective_equipment`), `description`,
`status` (`demonstrated` | `potential`), `evidence_type`, `limitations`, `supporting_finding` (start of a stored finding's text).

## mission_relevance.json — array (optional)
`mission_type`, `relevance_score` (0–1), `rationale`, `supporting_evidence` (list), `limitations` — only if the source documents it.

## Duplicates and re-uploads
Conditions, findings and text chunks are de-duplicated by content hash; figures by `(publication, figure_number)`; datasets by
name (replaced). Publications match on DOI, then title. Re-uploading the same package is safe. Ingestion is not one database
transaction: validation runs first and aborts on any fatal error before writing, but a network failure mid-write can leave a
partial result — simply re-upload.

## After ingestion
Keyword search works immediately. For semantic (pgvector) search, press **Embed pending chunks** (needs Gemini on the backend).
