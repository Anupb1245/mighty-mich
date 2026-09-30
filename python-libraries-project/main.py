"""Student Performance Analyzer - a mini project that showcases many Python libraries.

Standard library : argparse, csv, json, sqlite3, random, statistics, datetime,
                   pathlib, collections, re, logging, dataclasses
Third party      : numpy, pandas, matplotlib, seaborn, scipy, scikit-learn,
                   requests, beautifulsoup4, Pillow, rich, sympy

Run:  python main.py
Output (charts, report, database) is written to ./output
"""

import argparse
import csv
import json
import logging
import random
import re
import sqlite3
import statistics
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless backend so charts save without a display
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
import seaborn as sns
import sympy
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw
from rich.console import Console
from rich.table import Table
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split

OUT = Path(__file__).parent / "output"
console = Console()
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("project")


@dataclass
class Student:
    name: str
    study_hours: float
    attendance: float
    marks: float


def step(title: str) -> None:
    console.rule(f"[bold cyan]{title}")


# 1. random + dataclasses + csv + json ------------------------------------------------
def generate_data(n: int, seed: int) -> list[Student]:
    random.seed(seed)
    rng = np.random.default_rng(seed)  # numpy
    students = []
    for i in range(n):
        hours = round(float(rng.uniform(1, 10)), 1)
        attendance = round(float(rng.uniform(55, 100)), 1)
        marks = 8 * hours + 0.25 * attendance + rng.normal(0, 6)
        students.append(
            Student(f"Student{i + 1:02d}", hours, attendance, round(float(np.clip(marks, 0, 100)), 1))
        )
    with open(OUT / "students.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(asdict(students[0])))
        w.writeheader()
        w.writerows(asdict(s) for s in students)
    (OUT / "students.json").write_text(json.dumps([asdict(s) for s in students], indent=2))
    log.info("Generated %d students (csv + json)", n)
    return students


# 2. pandas + statistics + collections ------------------------------------------------
def analyze(df: pd.DataFrame) -> pd.DataFrame:
    df["grade"] = pd.cut(
        df["marks"], [-1, 39.99, 54.99, 69.99, 84.99, 100], labels=["F", "D", "C", "B", "A"]
    )
    table = Table(title="Summary (pandas + statistics + rich)")
    for col in ("Metric", "Value"):
        table.add_column(col)
    table.add_row("Mean marks", f"{df.marks.mean():.2f}")
    table.add_row("Median (statistics)", f"{statistics.median(df.marks):.2f}")
    table.add_row("Std dev", f"{statistics.stdev(df.marks):.2f}")
    table.add_row("Top student", df.loc[df.marks.idxmax(), "name"])
    console.print(table)
    console.print("Grade distribution (Counter):", dict(Counter(df["grade"])))
    return df


# 3. scipy ----------------------------------------------------------------------------
def statistical_tests(df: pd.DataFrame) -> dict:
    r, p = stats.pearsonr(df.study_hours, df.marks)
    high = df[df.attendance >= 80].marks
    low = df[df.attendance < 80].marks
    t, tp = stats.ttest_ind(high, low, equal_var=False)
    console.print(f"Pearson r (hours vs marks) = {r:.3f}, p = {p:.2e}")
    console.print(f"t-test (attendance >=80 vs <80) t = {t:.2f}, p = {tp:.3f}")
    return {"pearson_r": r, "pearson_p": p, "t": t, "t_p": tp}


# 4. scikit-learn ---------------------------------------------------------------------
def machine_learning(df: pd.DataFrame) -> LinearRegression:
    X, y = df[["study_hours", "attendance"]], df["marks"]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=1)
    model = LinearRegression().fit(Xtr, ytr)
    console.print(f"Linear regression R^2 on test set: {model.score(Xte, yte):.3f}")
    df["cluster"] = KMeans(n_clusters=3, n_init=10, random_state=1).fit_predict(X)
    console.print("KMeans cluster sizes:", df.cluster.value_counts().sort_index().to_dict())
    return model


# 5. matplotlib + seaborn -------------------------------------------------------------
def make_charts(df: pd.DataFrame) -> list[Path]:
    sns.set_theme(style="whitegrid")
    paths = []
    fig, axes = plt.subplots(1, 3, figsize=(16, 4.5))
    sns.histplot(df.marks, bins=10, kde=True, ax=axes[0]).set_title("Marks distribution")
    sns.regplot(data=df, x="study_hours", y="marks", ax=axes[1]).set_title("Study hours vs marks")
    sns.heatmap(df[["study_hours", "attendance", "marks"]].corr(), annot=True, cmap="viridis", ax=axes[2])
    axes[2].set_title("Correlation")
    fig.tight_layout()
    p = OUT / "dashboard.png"
    fig.savefig(p, dpi=120)
    plt.close(fig)
    paths.append(p)
    log.info("Saved %s", p.name)
    return paths


# 6. sqlite3 --------------------------------------------------------------------------
def save_to_db(df: pd.DataFrame) -> None:
    with sqlite3.connect(OUT / "students.db") as con:
        df.drop(columns=["grade"]).assign(grade=df.grade.astype(str)).to_sql(
            "students", con, if_exists="replace", index=False
        )
        rows = con.execute(
            "SELECT grade, COUNT(*), ROUND(AVG(marks),1) FROM students GROUP BY grade ORDER BY 3 DESC"
        ).fetchall()
    console.print("SQL grade summary (grade, count, avg):", rows)


# 7. sympy ----------------------------------------------------------------------------
def symbolic_math(model: LinearRegression) -> None:
    h, a = sympy.symbols("hours attendance")
    expr = sympy.Float(model.coef_[0], 4) * h + sympy.Float(model.coef_[1], 4) * a + sympy.Float(model.intercept_, 4)
    console.print(f"Model equation (sympy): marks = {expr}")
    console.print(f"Each extra study hour adds {sympy.diff(expr, h)} marks")


# 8. requests + beautifulsoup4 + re ---------------------------------------------------
def fetch_web() -> None:
    try:
        r = requests.get("https://www.python.org", timeout=8)
        soup = BeautifulSoup(r.text, "html.parser")
        title = soup.title.string.strip() if soup.title else "?"
        links = len(soup.find_all("a"))
        version = re.search(r"Python\s+(\d+\.\d+\.\d+)", r.text)
        console.print(f"Fetched '{title}' - {links} links; latest version mentioned: {version.group(1) if version else 'n/a'}")
    except requests.RequestException as exc:
        console.print(f"[yellow]Web step skipped (offline?): {type(exc).__name__}")


# 9. Pillow ---------------------------------------------------------------------------
def make_certificate(name: str, marks: float) -> Path:
    img = Image.new("RGB", (600, 250), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([8, 8, 591, 241], outline="navy", width=4)
    d.text((190, 60), "CERTIFICATE OF EXCELLENCE", fill="navy")
    d.text((220, 110), f"{name} - {marks} marks", fill="black")
    d.text((190, 180), datetime.now().strftime("Issued %d %b %Y"), fill="gray")
    p = OUT / "certificate.png"
    img.save(p)
    log.info("Saved %s", p.name)
    return p


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-n", type=int, default=60, help="number of students")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--offline", action="store_true", help="skip the web step")
    args = ap.parse_args()

    OUT.mkdir(exist_ok=True)
    step("1. Data generation (random, numpy, csv, json, dataclasses)")
    df = pd.DataFrame([asdict(s) for s in generate_data(args.n, args.seed)])
    step("2. Analysis (pandas, statistics, collections, rich)")
    df = analyze(df)
    step("3. Statistical tests (scipy)")
    results = statistical_tests(df)
    step("4. Machine learning (scikit-learn)")
    model = machine_learning(df)
    step("5. Charts (matplotlib, seaborn)")
    make_charts(df)
    step("6. Database (sqlite3)")
    save_to_db(df)
    step("7. Symbolic math (sympy)")
    symbolic_math(model)
    step("8. Web scraping (requests, beautifulsoup4, re)")
    if not args.offline:
        fetch_web()
    step("9. Image generation (Pillow)")
    best = df.loc[df.marks.idxmax()]
    make_certificate(best["name"], best["marks"])
    (OUT / "report.json").write_text(json.dumps({k: float(v) for k, v in results.items()}, indent=2))
    console.print(f"\n[bold green]Done![/] Outputs are in {OUT}")


if __name__ == "__main__":
    main()
