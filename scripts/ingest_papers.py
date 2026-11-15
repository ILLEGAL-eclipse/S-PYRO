"""Ingest original source PDFs (stored byte-for-byte) with publication metadata transcribed from each paper's first page.

  or-5.pdf  Stocker (2022)            -> attached to the existing INV-ACME-001
  or-4.pdf  Dietrich et al. (2014)    -> INV-FLEX-001 (new)
  or-2.pdf  Nayagam et al. (2013)     -> INV-FLEX-001 (same investigation, 2nd publication)
  or-1.pdf  Haggard et al. (DCE)      -> INV-DCE-001 (new).  or-3.pdf is a byte-identical copy and is skipped.

No scientific conditions/findings are created here: those need extraction files. Only the original PDF, its page text
(chunks, layer 'original') and bibliographic metadata are stored.

Usage (from backend/):  python ../scripts/ingest_papers.py <folder with or-N.pdf> [--dry-run]
"""
import argparse
import hashlib
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "backend"))

ACME_ABSTRACT = (
    "From late 2017 to early 2022, six independent studies with flames of gaseous fuels were conducted on the International Space "
    "Station (ISS) in the U.S. combustion research facility. An exploration of flames at the extremes of high sooting and high dilution "
    "was conducted with a coaxial coflow burner, where the fuel and oxidizer velocities were typically matched. An investigation of "
    "electric-field effects also used the same coflow burner as well as a simple gas-jet burner, with a circular electrode mesh, "
    "downstream of the burner, at voltages of either polarity up to 10 kV. A study focused on material flammability in a quiescent "
    "atmosphere emulated the burning of condensed-phased fuels using cylindrical burners with a flat perforated outlet instrumented to "
    "measure the heat flux to the burner, i.e., emulated fuel. Three studies of soot processes, flame dynamics, and low-temperature "
    "combustion used porous spherical burners, yielding a nominally one-dimensional flame structure. The objectives and selected "
    "findings of each investigation will be briefly discussed after a short review of the advantages of studying combustion in "
    "microgravity, earlier ISS research, and the experimental hardware and its operation.")

FLEX_2014_ABSTRACT = (
    "This paper summarizes the first results from isolated droplet combustion experiments performed on the International Space Station "
    "(ISS). The long durations of microgravity provided in the ISS enable the measurement of droplet and flame histories over an "
    "unprecedented range of conditions. The first experiments were with heptane and methanol as fuels, initial droplet droplet diameters "
    "between 1.5 and 5.0 mm, ambient oxygen mole fractions between 0.1 and 0.4, ambient pressures between 0.7 and 3.0 atm and ambient "
    "environments containing oxygen and nitrogen diluted with both carbon dioxide and helium. The experiments show both radiative and "
    "diffusive extinction. For both fuels, the flames exhibited pre-extinction flame oscillations during radiative extinction with a "
    "frequency of approximately 1 Hz. The results revealed that as the ambient oxygen mole fraction was reduced, the diffusive-extinction "
    "droplet diameter increased and the radiative-extinction droplet diameter decreased. In between these two limiting extinction "
    "conditions, quasi-steady combustion was observed. Another important measurement that is related to spacecraft fire safety is the "
    "limiting oxygen index (LOI), the oxygen concentration below which quasi-steady combustion cannot be supported. This is also the "
    "ambient oxygen mole fraction for which the radiative and diffusive extinction diameters become equal. For oxygen/nitrogen mixtures, "
    "the LOI is 0.12 and 0.15 for methanol and heptane, respectively. The LOI increases to approximately 0.14 (0.14 O2/0.56 N2/0.30 CO2) "
    "and 0.17 (0.17 O2/0.63 N2/0.20 CO2) for methanol and heptane, respectively, for ambient environments that simulated dispersing an "
    "inert-gas suppressant (carbon dioxide) into a nominally air (1.0 atm) ambient environment. The LOI is approximately 0.14 and 0.15 "
    "for methanol and heptane, respectively, when helium is dispersed into air at 1 atm. The experiments also showed unique burning "
    "behavior for large heptane droplets. After the visible hot flame radiatively extinguished around a large heptane droplet, the "
    "droplet continued to burn with a cool flame. This phenomena was observed repeatably over a wide range of ambient conditions. These "
    "cool flames were invisible to the experiment imaging system but their behavior was inferred by the sustained quasi-steady burning "
    "after visible flame extinction. Verification of this new burning regime was established by both theoretical and numerical analysis "
    "of the experimental results. These innovative experiments have provided a wealth of new data for improving the understanding of "
    "droplet combustion and related aspects of fire safety, as well as offering important measurements that can be used to test "
    "sophisticated evolving computational models and theories of droplet combustion.")

FLEX_2013_ABSTRACT = (
    "The Flame Extinguishment (FLEX) experiment that is currently underway in the Combustion Integrated Rack facility onboard the "
    "International Space Station is aimed at understanding the effects of inert diluents on the flammability of condensed phase fuels. "
    "To this end, droplets of various fuels, including alkanes and alcohols, are burned in a quiescent microgravity environment with "
    "varying amounts of oxygen and inert diluents to determine the limiting oxygen index (LOI) for these fuels. In this study we report "
    "experimental observations of methanol droplets burning in oxygen-nitrogen-carbon dioxide and oxygen-nitrogen-helium gas mixtures at "
    "0.7 and 1 atmospheric pressures. The initial droplet size varied between approximately 1.5 mm and 4 mm to capture both diffusive "
    "extinction brought about by insufficient residence time at the flame and radiative extinction caused by excessive heat loss from "
    "the flame zone. The ambient oxygen concentration varied from a high value of 30% by volume to as low as 12%, approaching the "
    "limiting oxygen index for the fuel. The inert dilution by carbon dioxide and helium varied over a range of 0% to 70% by volume. In "
    "these experiments, both freely floated and tethered droplets were ignited using symmetrically opposed hot-wire igniters and the "
    "burning histories were recorded onboard using digital cameras, downlinked later to the ground for analysis. The digital images "
    "yielded droplet and flame diameters as functions of time and subsequently droplet burning rate, flame standoff ratio, and initial "
    "and extinction droplet diameters. Simplified theoretical models correlate the measured burning rate constant and the flame standoff "
    "ratio reasonably well. An activation energy asymptotic theory accounting for time-dependent water dissolution or evaporation from "
    "the droplet is shown to predict the measured diffusive extinction conditions well. The experiments also show that the limiting "
    "oxygen index for methanol in these diluent gases is around 12% to 13% oxygen by volume.")

DCE_ABSTRACT = (
    "The first space-based experiments were performed on the combustion of free, individual liquid fuel droplets in oxidizing "
    "atmospheres. The fuel was heptane, with initial droplet diameters ranging about from 1 mm to 4 mm. The atmospheres were mixtures of "
    "helium and oxygen, at pressures of 1.00, 0.50 and 0.25 bar, with oxygen mole fractions between 20% and 40%, as well as normal "
    "Spacelab cabin air. The temperatures of the atmospheres and of the initial liquid fuel were nominally 300 K. A total of 44 droplets "
    "were burned successfully on the two flights, 8 on the shortened STS-83 mission and 36 on STS-94. The results spanned the full range "
    "of heptane droplet combustion behavior, from radiative flame extinction at larger droplet diameters in the more dilute atmospheres "
    "to diffusive extinction in the less dilute atmospheres, with the droplet disappearing prior to flame extinction at the highest "
    "oxygen concentrations. Quasisteady histories of droplet diameters were observed along with unsteady histories of flame diameters. "
    "New and detailed information was obtained on burning rates, flame characteristics and soot behavior. The results have motivated "
    "new computational and theoretical investigations of droplet combustion, improving knowledge of the chemical kinetics, fluid "
    "mechanics and heat and mass transfer processes involved in burning liquid fuels.")

NEW_INVESTIGATIONS = {
    "INV-FLEX-001": {
        "investigation_code": "INV-FLEX-001", "title": "Flame Extinguishment Experiment (FLEX)",
        "abstract": FLEX_2014_ABSTRACT, "research_category": "Microgravity Droplet Combustion", "investigation_type": "Flight experiment (ISS)",
        "combustion_phenomena": ["Radiative extinction", "Diffusive extinction", "Limiting oxygen index (LOI)", "Cool flames (heptane droplets)"],
        "keywords": ["Combustion", "Droplet combustion", "Microgravity", "International space station", "Experiments", "Fire safety"],
        "objectives": ["Understand the effects of inert diluents on the flammability of condensed phase fuels (determine the limiting oxygen index for these fuels)."],
        "metadata": {"facility": "Combustion Integrated Rack (CIR) with the Multi-User Droplet Combustion Apparatus (MDCA), NASA Glenn Research Center",
                     "metadata_basis": "Transcribed from the first pages of the stored papers; no structured extraction supplied."},
        "publications": [
            {"title": "Droplet Combustion Experiments Aboard the International Space Station",
             "authors": ["Daniel L. Dietrich", "Vedha Nayagam", "Michael C. Hicks", "Paul V. Ferkul", "Frederick L. Dryer", "Tanvir Farouk", "Benjamin D. Shaw",
                         "Hyun Kyu Suh", "Mun Y. Choi", "Yu Cheng Liu", "C. Thomas Avedisian", "Forman A. Williams"],
             "publication_year": 2014, "doi": "10.1007/s12217-014-9372-2", "journal": "Microgravity Science and Technology 26:65–76",
             "publication_type": "Journal article", "abstract": FLEX_2014_ABSTRACT, "file_name": "or-4.pdf"},
            {"title": "Methanol Droplet Combustion in Oxygen-Inert Environments in Microgravity",
             "authors": ["Vedha Nayagam", "Daniel L. Dietrich", "Michael C. Hicks", "Forman A. Williams"], "publication_year": 2013, "doi": None,
             "journal": "8th US National Combustion Meeting, Western States Section of the Combustion Institute (Paper # 070HE-0303), University of Utah, May 19–22, 2013",
             "publication_type": "Conference paper", "abstract": FLEX_2013_ABSTRACT, "file_name": "or-2.pdf"},
        ]},
    "INV-DCE-001": {
        "investigation_code": "INV-DCE-001", "title": "Droplet Combustion Experiment (DCE)",
        "abstract": DCE_ABSTRACT, "research_category": "Microgravity Droplet Combustion", "investigation_type": "Flight experiment (Space Shuttle)",
        "combustion_phenomena": ["Radiative extinction", "Diffusive extinction", "Soot formation"],
        "keywords": ["droplet combustion", "heptane", "microgravity", "STS-83", "STS-94", "MSL-1"],
        "objectives": ["Improve understanding of the mechanisms of burning of liquid fuel droplets."],
        "metadata": {"principal_investigator": "Dr. Forman A. Williams, University of California, San Diego",
                     "flights": "STS-83 (shortened) and STS-94 (MSL-1)", "publication_year_note": "No publication year is printed on the stored document.",
                     "metadata_basis": "Transcribed from the first pages of the stored paper; no structured extraction supplied."},
        "publications": [
            {"title": "Droplet Combustion Experiment", "authors": ["John B. Haggard, Jr.", "Vedha Nayagam", "Frederick L. Dryer", "Forman A. Williams"],
             "publication_year": None, "doi": None, "journal": "NASA Lewis Research Center report, pp. 45–57 of a compiled volume",
             "publication_type": "Report", "abstract": DCE_ABSTRACT, "file_name": "or-1.pdf"}]},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    src = pathlib.Path(a.folder)
    from app.services.ingest import ingest_package

    # byte-identical duplicate check
    h = lambda n: hashlib.sha256((src / n).read_bytes()).hexdigest()  # noqa: E731
    print("or-1 == or-3 (identical bytes):", h("or-1.pdf") == h("or-3.pdf"))

    jobs = []
    for code, inv in NEW_INVESTIGATIONS.items():
        files = {"investigation.json": json.dumps(inv).encode()}
        for p in inv["publications"]:
            files[p["file_name"]] = (src / p["file_name"]).read_bytes()
        jobs.append((code, files))

    # ACME: existing package + full abstract from the paper + its original PDF
    acme = json.loads((pathlib.Path(__file__).resolve().parent.parent / "data/packages/INV-ACME-001/investigation.json").read_text(encoding="utf-8"))
    acme["abstract"] = ACME_ABSTRACT
    acme["publication"]["abstract"] = ACME_ABSTRACT
    acme["publication"]["file_name"] = "or-5.pdf"
    files = {"investigation.json": json.dumps(acme).encode(), "or-5.pdf": (src / "or-5.pdf").read_bytes()}
    jobs.append(("INV-ACME-001", files))

    for code, files in jobs:
        rep = ingest_package(files, None, dry_run=a.dry_run)
        print(code, json.dumps({k: rep.get(k) for k in ("ok", "investigation", "publications", "pdfs", "errors", "warnings")}, indent=1, default=str))


if __name__ == "__main__":
    main()
