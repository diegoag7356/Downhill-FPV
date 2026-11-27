#!/usr/bin/env python3
"""Genera un modelo 3D (.glb) con el Space tencent/Hunyuan3D-2 de Hugging Face.

Acepta una imagen de referencia o un prompt de texto y guarda el .glb resultante
en la carpeta assets_3d/.

Ejemplos:
    python generar_3d.py --imagen bicicleta.jpeg --nombre bicicleta
    python generar_3d.py --imagen pista.jpeg --nombre pista --octree 256
    python generar_3d.py --prompt "downhill mountain bike, matte black frame" --nombre bici

Si el Space exige autenticación, exporta un token con permiso de lectura:
    export HF_TOKEN=hf_...
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

SPACE_ID = "tencent/Hunyuan3D-2"
ASSETS_DIR = Path(__file__).resolve().parent / "assets_3d"
GLB_MAGIC = b"glTF"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Genera un .glb desde una imagen o un prompt con Hunyuan3D-2."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--imagen", "--image", dest="imagen", type=Path, help="Ruta de la imagen de referencia.")
    source.add_argument("--prompt", "--texto", dest="prompt", type=str, help="Prompt de texto para generar el modelo.")
    parser.add_argument("--nombre", "--name", dest="nombre", type=str, default=None, help="Nombre del archivo de salida sin extensión.")
    parser.add_argument("--salida", "--out", dest="salida", type=Path, default=ASSETS_DIR, help="Carpeta de destino (por defecto assets_3d/).")
    parser.add_argument("--pasos", "--steps", dest="steps", type=int, default=30, help="Pasos de inferencia (por defecto 30).")
    parser.add_argument("--guia", "--guidance", dest="guidance", type=float, default=5.0, help="Guidance scale (por defecto 5.0).")
    parser.add_argument("--semilla", "--seed", dest="seed", type=int, default=1234, help="Semilla (por defecto 1234).")
    parser.add_argument("--octree", dest="octree", type=int, default=256, help="Resolución octree (por defecto 256).")
    parser.add_argument("--chunks", dest="chunks", type=int, default=8000, help="Número de chunks (por defecto 8000).")
    parser.add_argument("--sin-quitar-fondo", dest="rembg", action="store_false", help="No quitar el fondo de la imagen.")
    parser.add_argument("--token", dest="token", type=str, default=None, help="Token de Hugging Face (por defecto HF_TOKEN del entorno).")
    parser.set_defaults(rembg=True)
    return parser.parse_args(argv)


def resolve_output(args: argparse.Namespace) -> Path:
    args.salida.mkdir(parents=True, exist_ok=True)
    if args.nombre:
        name = args.nombre.strip()
    elif args.imagen:
        name = args.imagen.stem
    else:
        name = "modelo"
    name = "".join(c for c in name if c.isalnum() or c in "-_") or "modelo"
    return args.salida / f"{name}.glb"


def first_file(value) -> str | None:
    """Extrae la ruta del archivo de la respuesta del endpoint."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("path", "name", "value"):
            if isinstance(value.get(key), str):
                return value[key]
        return None
    if isinstance(value, (list, tuple)):
        for item in value:
            found = first_file(item)
            if found:
                return found
        return None
    return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.imagen and not args.imagen.is_file():
        print(f"Error: no existe la imagen {args.imagen}", file=sys.stderr)
        return 2

    try:
        from gradio_client import Client, handle_file
    except ImportError:
        print("Error: falta gradio_client. Instálalo con `pip install gradio_client`.", file=sys.stderr)
        return 2

    token = args.token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    print(f"Conectando con el Space {SPACE_ID}…")
    client = Client(SPACE_ID, token=token, verbose=False)

    payload = {
        "caption": args.prompt or "",
        "image": handle_file(str(args.imagen)) if args.imagen else None,
        "steps": args.steps,
        "guidance_scale": args.guidance,
        "seed": args.seed,
        "octree_resolution": args.octree,
        "check_box_rembg": args.rembg,
        "num_chunks": args.chunks,
    }
    print("Generando malla (esto puede tardar varios minutos)…")
    result = client.predict(api_name="/shape_generation", **payload)

    source = first_file(result)
    if not source or not Path(source).is_file():
        print(f"Error: el Space no devolvió un archivo válido: {result!r}", file=sys.stderr)
        return 1

    destination = resolve_output(args)
    shutil.copyfile(source, destination)
    with destination.open("rb") as handle:
        header = handle.read(4)
    if header != GLB_MAGIC:
        print(f"Advertencia: {destination} no empieza por la firma glTF ({header!r}).", file=sys.stderr)
    print(f"Modelo guardado en {destination} ({destination.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
