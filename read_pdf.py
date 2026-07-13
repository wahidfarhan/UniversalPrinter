import subprocess
import sys
import os

def install_and_extract():
    try:
        import pypdf
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pypdf"])
        import pypdf
        
    reader = pypdf.PdfReader("report.pdf")
    text = ""
    for idx, page in enumerate(reader.pages):
        text += f"--- PAGE {idx+1} ---\n"
        text += page.extract_text() + "\n"
        
    with open("report_extracted.txt", "w", encoding="utf-8") as f:
        f.write(text)
    print("PDF extracted successfully to report_extracted.txt")

if __name__ == "__main__":
    install_and_extract()
