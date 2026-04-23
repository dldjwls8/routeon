"""
시드 파일 컬럼 구조 확인 스크립트
실행: python backend/seeds/inspect_files.py
"""
import csv
from pathlib import Path

SEEDS_DIR = Path(__file__).parent

print("=" * 60)
print("📄 CSV 파일 확인")
print("=" * 60)

csv_file = SEEDS_DIR / "한국도로공사_졸음쉼터_20260225.csv"
if csv_file.exists():
    with open(csv_file, encoding="euc-kr", newline="") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        print(f"\n[졸음쉼터 CSV] 컬럼명:")
        for h in headers:
            print(f"  - {h}")
        # 첫 번째 행 샘플
        first = next(reader)
        print(f"\n샘플 데이터 (1행):")
        for k, v in first.items():
            print(f"  {k}: {v}")
else:
    print(f"❌ 파일 없음: {csv_file}")

print("\n" + "=" * 60)
print("📊 XLS 파일 확인")
print("=" * 60)

try:
    import xlrd

    xls_files = [
        ("휴게소정보_260325.xls", "highway_rest"),
        ("공영차고지정보_260325.xls", "depot"),
    ]

    for filename, type_name in xls_files:
        filepath = SEEDS_DIR / filename
        if not filepath.exists():
            print(f"\n❌ 파일 없음: {filename}")
            continue

        wb = xlrd.open_workbook(str(filepath))
        ws = wb.sheet_by_index(0)
        headers = [ws.cell_value(0, c) for c in range(ws.ncols)]

        print(f"\n[{filename}] 컬럼명 ({type_name}):")
        for i, h in enumerate(headers):
            print(f"  [{i}] {h}")

        print(f"\n샘플 데이터 (2행):")
        for c, h in enumerate(headers):
            print(f"  {h}: {ws.cell_value(1, c)}")

except ImportError:
    print("❌ xlrd 설치 필요: pip install xlrd")