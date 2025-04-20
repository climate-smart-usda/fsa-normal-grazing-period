This repository is an archive of the annual county-level normal grazing period data for the [Livestock Forage Disaster Program](https://www.fsa.usda.gov/programs-and-services/disaster-assistance-program/livestock-forage/index). These data were acquired via Freedom of Information Act (FOIA) request 2025-FSA-04691-F made by R. Kyle Bocinsky, Director of Climate Extension for the [Montana Climate Office](https://climate.umt.edu), to the US Department of Agriculture (USDA) [Farm Production and Conservation Business Center (FPAC-BC)](https://www.fpacbc.usda.gov). The request was submitted on February 14, 2025, and was fulfilled on April 15, 2025.

The original FOIA request, copies of all email communications with the USDA Farm Production and Conservation Business Center (FPAC-BC), and data as received are in the [`foia`](/foia) directory and [`foia/2025-FSA-04691-F Bocinsky.zip`](/foia/2025-FSA-04691-F%20Bocinsky.zip) zip archive.

<iframe
  id="inlineFrameExample"
  title="Inline Frame Example"
  src="fsa-normal-grazing-period.html">
</iframe>

Data were ingested into the [R statistical framework](https://www.r-project.org), were cleaned to a common set of fields and filtered to only include counties in the contiguous United States, and then were written to a consolidated CSV file ([`fsa-normal-grazing-period.csv`](/fsa-normal-grazing-period.csv)) and mapped in multi-page PDF ([`fsa-normal-grazing-period.pdf`](/fsa-normal-grazing-period.pdf)). [`fsa-normal-grazing-period.R`](/fsa-normal-grazing-period.R) is the R script that cleans the data and produces the maps.

The FSA uses slightly different county or county equivalent definitions for their service areas than the standard ANSI FIPS areas used by the US Census. The FSA counties are included in the [`fsa-counties`](/fsa-counties) directory; FSA county codes are detailed in [FSA Handbook 1-CM](https://www.fsa.usda.gov/Internet/FSA_File/1-cm_r03_a80.pdf), Exhibit 101.

Data in the [`foia/2025-FSA-04691-F Bocinsky.zip`](/foia/2025-FSA-04691-F%20Bocinsky.zip) archive were produced by the USDA Farm Service Agency and are in the Public Domain. All other data, including the processed data and maps were created by R. Kyle Bocinsky and are released under the [Creative Commons CCZero license](https://creativecommons.org/publicdomain/zero/1.0/). The [`fsa-lfp-eligibility.R`](/fsa-lfp-eligibility.R) script is copyright R. Kyle Bocinsky, and is released under the [MIT License](/LICENSE.md).

## 📜 Citation

If using this data in published work, consider citing it as:

> USDA Farm Service Agency. *FSA_Counties_dd17 Geospatial Dataset*. Accessed via GitHub archive, YYYY. Original metadata reference: [1-GIS Amendment 2 (2009)](https://www.fsa.usda.gov/Internet/FSA_File/1-gis_r00_a02.pdf).

## 📄 License

Data in the `FSA_Counties_dd17.gdb.zip` archive were produced by the United States Department of Agriculture (USDA), which are in the public domain under U.S. law (17 USC § 105).

You are free to: 

  - Use, modify, and distribute the data for any purpose 
  - Include it in derivative works or applications, with or without attribution

If you modify or build upon the data, you are encouraged (but not required) to clearly mark any changes and cite this repository as the source of the original.

> No warranty is provided. Use at your own risk.

The derivatives `fsa-counties-dd17.topojson` and `fsa-counties-dd17-albers.topojson` were created by R. Kyle Bocinsky and are released under the [Creative Commons CCZero license](https://creativecommons.org/publicdomain/zero/1.0/).

The [`fsa-counties-dd17.R`](fsa-counties-dd17.R) script is copyright R. Kyle Bocinsky, and is released under the [MIT License](LICENSE).

## ⚠️ Disclaimer

This dataset is archived for reference and educational use. It may not reflect current administrative boundaries and should not be used for official USDA program administration. Always consult the USDA or state FSA office for current data.

## 👏 Acknowledgment

This work is part of the [*Enhancing Climate-smart Disaster Relief in FSA Programs: Non-stationarity at the Intersection of Normal Grazing Periods and US Drought Assessment*](https://www.ars.usda.gov/research/project/?accnNo=444612) project. It is supported by US Department of Agriculture Office of the Chief Economist (OCE), Office of Energy and Environmental Policy (OEEP) funds passed through to Research, Education, and Economics mission area. We also acknowledge and appreciate the assistance of the USDA Climate Hubs in securing these data.

## ✉️ Contact

Please contact Kyle Bocinsky ([kyle.bocinsky@umontana.edu](mailto:kyle.bocinsky@umontana.edu)) with any questions.
