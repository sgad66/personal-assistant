import sys
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def recognize_image(path):
    from rapidocr_onnxruntime import RapidOCR
    lines, _ = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)(path)
    return "\n".join(line[1] for line in lines or [])


def recognize_voice(path):
    import numpy as np
    import sherpa_onnx
    from imageio_ffmpeg import get_ffmpeg_exe

    audio = subprocess.run(
        [get_ffmpeg_exe(), "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
         "-i", path, "-t", "300", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
        stdout=subprocess.PIPE, check=True, timeout=30
    )
    model = ROOT / "models"
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model / "model.int8.onnx"), tokens=str(model / "tokens.txt"),
        language="auto", use_itn=True, num_threads=2
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, np.frombuffer(audio.stdout, dtype="<f4"))
    recognizer.decode_stream(stream)
    return re.sub(r"<\|[^|]+\|>", "", stream.result.text).strip()


def document_text(kind):
    from io import BytesIO
    source = BytesIO(sys.stdin.buffer.read())
    if kind == "pdf":
        from pypdf import PdfReader
        lines = (page.extract_text() or "" for page in PdfReader(source).pages)
    else:
        from xml.etree import ElementTree
        from zipfile import ZipFile
        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        with ZipFile(source) as archive:
            if archive.getinfo("word/document.xml").file_size > 32 * 1024 * 1024:
                raise ValueError("Document too large")
            root = ElementTree.fromstring(archive.read("word/document.xml"))
        lines = ("".join(t.text or "" for t in p.iter(ns + "t")) for p in root.iter(ns + "p"))
    chunks = []
    total = 0
    for line in lines:
        chunks.append(line[:32001])
        total += len(line) + 1
        if total >= 32001:
            break
    return "\n".join(chunks)[:32001]


if __name__ == "__main__" and sys.argv[1] in ("pdf", "docx"):
    print(document_text(sys.argv[1]))
elif __name__ == "__main__":
    recognize = recognize_image if sys.argv[1] == "vision" else recognize_voice
    print(recognize(sys.argv[2]))
