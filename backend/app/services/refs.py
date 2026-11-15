"""Citation registry. Every citable source record encountered during retrieval receives a short ref
(R1, R2, ...). Answers may only cite refs that exist here; unknown refs are stripped."""
import re

from ..schemas import Citation

_CITE = re.compile(r"\[(R\d+(?:\s*,\s*R\d+)*)\]")


class RefRegistry:
    def __init__(self) -> None:
        self._by_key: dict[tuple, str] = {}
        self._refs: dict[str, Citation] = {}

    def add(self, *, kind: str, label: str, investigation_id=None, investigation_title=None, publication_id=None,
            publication_title=None, page=None, section=None, figure=None, table=None, quote=None) -> str:
        key = (kind, investigation_id, publication_id, page, section, figure, table, (quote or "")[:80])
        if key in self._by_key:
            return self._by_key[key]
        ref = f"R{len(self._refs) + 1}"
        self._by_key[key] = ref
        self._refs[ref] = Citation(
            ref=ref, kind=kind, label=label,
            investigation_id=str(investigation_id) if investigation_id else None, investigation_title=investigation_title,
            publication_id=str(publication_id) if publication_id else None, publication_title=publication_title,
            page=page, section=section, figure=figure, table=table, quote=(quote[:400] if quote else None))
        return ref

    def get(self, ref: str) -> Citation | None:
        return self._refs.get(ref)

    def all(self) -> dict[str, Citation]:
        return dict(self._refs)

    def resolve_answer(self, text: str) -> tuple[str, list[Citation], list[str]]:
        """Strip citations that do not exist; return (clean text, used citations in order, warnings)."""
        used: list[str] = []
        bad: list[str] = []

        def sub(m: re.Match) -> str:
            ids = [x.strip() for x in m.group(1).split(",")]
            good = [i for i in ids if i in self._refs]
            bad.extend(i for i in ids if i not in self._refs)
            for g in good:
                if g not in used:
                    used.append(g)
            return f"[{', '.join(good)}]" if good else ""

        clean = _CITE.sub(sub, text)
        warnings = []
        if bad:
            warnings.append(f"Removed {len(bad)} citation marker(s) that did not match any retrieved source: {', '.join(sorted(set(bad)))}.")
        return clean, [self._refs[u] for u in used], warnings
