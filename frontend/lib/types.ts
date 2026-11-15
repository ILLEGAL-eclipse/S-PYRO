export interface Citation {
  ref: string;
  kind: string;
  label: string;
  investigation_id?: string | null;
  investigation_title?: string | null;
  publication_id?: string | null;
  publication_title?: string | null;
  page?: number | null;
  section?: string | null;
  figure?: string | null;
  table?: string | null;
  quote?: string | null;
}
export type Citations = Record<string, Citation>;

export interface InvestigationCard {
  id: string;
  investigation_code: string;
  title: string;
  description: string | null;
  research_category: string | null;
  investigation_type: string | null;
  combustion_phenomena: string[];
  keywords: string[];
  publication_count: number;
  publication_years: number[];
  gravity_classes: string[];
  finding_count?: number;
  telemetry?: { oxygen?: number[]; pressure?: number[]; temperature?: number[] };
  counts?: { findings: number; figures: number; datasets: number };
}

export interface Paged<T> { items: T[]; total: number; page: number; page_size: number; pages?: number }

export interface Condition {
  id: string; parameter: string; parameter_key: string | null; value: string; unit: string | null; context: string | null;
  normalized_value: number | null; normalized_unit: string | null; value_class: string | null;
  source_page: number | null; source_section: string | null; source_table: string | null; source_figure: string | null;
  publication_id: string | null; ref: string;
}
export interface Finding {
  id: string; description: string; evidence_type: string; phenomenon: string | null; reported_values: Record<string, unknown>;
  source_page: number | null; source_section: string | null; source_figure: string | null; source_table: string | null;
  publication_id: string | null; ref: string;
}
export interface Publication {
  id: string; investigation_id: string; title: string; authors: string[]; publication_year: number | null; doi: string | null;
  journal: string | null; publication_type: string | null; source_url: string | null; abstract: string | null;
  has_original: boolean; pdf_url?: string | null; download_url?: string | null;
  investigation?: { id: string; code: string; title: string } | null;
  investigation_code?: string; investigation_title?: string;
}
export interface Figure {
  id: string; figure_number: string; caption: string | null; page_number: number | null; image_url: string | null;
  x_axis: string | null; y_axis: string | null; units: string | null; description: string | null;
  qualitative_observations: string | null; publication_id: string | null; ref: string;
}
export interface DatasetMeta {
  id: string; investigation_id: string; dataset_name: string; description: string | null; source_page: number | null;
  source_table: string | null; publication_id: string | null; investigation_code?: string; investigation_title?: string;
}
export interface FireApp {
  category: string; description: string; status: "demonstrated" | "potential"; evidence_type: string | null; limitations: string | null;
  investigation: { id: string; code: string | null; title: string | null }; ref: string;
  supporting_finding: { description: string; evidence_type: string } | null; publication: { id: string; title: string } | null;
}
export interface InvestigationDetail {
  card: InvestigationCard | null;
  investigation: {
    id: string; investigation_code: string; title: string; description: string | null; abstract: string | null;
    research_category: string | null; investigation_type: string | null; combustion_phenomena: string[]; keywords: string[];
    objectives: string[]; methodology: string | null; references: unknown; metadata: { limitations?: string[] } & Record<string, unknown>;
  };
  publications: Publication[];
  conditions: Condition[];
  findings: Finding[];
  figures: Figure[];
  datasets: DatasetMeta[];
  mission_relevance: { id: string; mission_type: string; relevance_score: number | null; rationale: string | null; limitations: string | null }[];
  fire_safety: FireApp[];
  ai_generated_summary: { text: string; notice: string } | null;
  citations: Citations;
}

export type Classification = "MATCH" | "DISCREPANCY" | "CONTEXT MISMATCH" | "NOT FOUND" | "INSUFFICIENT EVIDENCE";
export interface ValidationIssue {
  id: string; session_id: string; issue_type: string; classification: Classification; parameter: string | null;
  researcher_value: string | null; source_value: string | null; publication_id: string | null; investigation_id: string | null;
  source_page: number | null; source_section: string | null; source_figure: string | null; source_table: string | null;
  explanation: string; status: "open" | "acknowledged" | "resolved" | "not_applicable"; researcher_note: string | null;
  publication_title: string | null; investigation_code: string | null; investigation_title: string | null;
  source_record: { candidates?: { id: string; code: string; title: string }[]; ai_assisted?: boolean } & Record<string, unknown>;
}
export interface ValidationSession {
  session: {
    id: string; input_type: string; created_at: string; submitted_input: { raw: string; filename?: string | null };
    context: { investigation: { id: string; code: string; title: string } | null; counts: Record<string, number>; warnings: string[]; items_checked: number; tolerance_relative: number };
  };
  issues: ValidationIssue[];
}
