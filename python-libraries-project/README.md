# Student Performance Analyzer — Python Libraries Mini Project

One script (`main.py`) that generates student data, analyzes it, trains a model, draws charts,
stores results in a database, scrapes a web page and makes a certificate image.

| Step | Libraries |
| --- | --- |
| Data generation | `random`, `numpy`, `csv`, `json`, `dataclasses` |
| Analysis | `pandas`, `statistics`, `collections`, `rich` |
| Statistics | `scipy` |
| Machine learning | `scikit-learn` (LinearRegression, KMeans) |
| Charts | `matplotlib`, `seaborn` |
| Database | `sqlite3` |
| Symbolic math | `sympy` |
| Web | `requests`, `beautifulsoup4`, `re` |
| Images | `Pillow` |
| CLI / logging | `argparse`, `logging`, `pathlib`, `datetime` |

## Run
```bash
pip install -r requirements.txt
python main.py            # add --offline to skip the web step, -n 100 for more students
```
Results (charts, CSV/JSON, SQLite DB, certificate) appear in `output/`.
