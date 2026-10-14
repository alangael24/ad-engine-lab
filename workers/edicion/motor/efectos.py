"""Composición de sprites, curvas de animación e imágenes (recorte de croma, bordes de papel, Ken Burns)."""
from __future__ import annotations
import math
from functools import lru_cache

import cv2
import numpy as np

from .texto import premul


def clamp(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def ease_out(p: float) -> float:
    p = clamp(p)
    return 1 - (1 - p) ** 3


def ease_out_back(p: float, s: float = 1.9) -> float:
    p = clamp(p) - 1
    return 1 + (s + 1) * p ** 3 + s * p ** 2


class Lienzo:
    """Cuadro de salida (float32 0-1) que registra elementos que se salen del encuadre para el control de calidad."""

    def __init__(self, frame: np.ndarray):
        self.f = frame
        self.h, self.w = frame.shape[:2]
        self.recortes = 0
        self.cajas = []  # (etiqueta, x0, y0, x1, y1) de textos dibujados

    def poner(self, spr: np.ndarray, cx: float, cy: float, escala: float = 1.0, alpha: float = 1.0,
              blur: float = 0.0, giro: float = 0.0, etiqueta: str | None = None):
        if alpha <= 0.003 or escala <= 0.01:
            return
        s = spr
        if blur > 0.6:
            k = int(blur) * 2 + 1
            s = cv2.GaussianBlur(s, (k, k), 0)
        h, w = s.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), giro, escala)
        M[0, 2] += cx - w / 2
        M[1, 2] += cy - h / 2
        esq = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], np.float32) @ M.T
        X0, Y0 = np.floor(esq.min(0)).astype(int)
        X1, Y1 = np.ceil(esq.max(0)).astype(int)
        if etiqueta:
            self.cajas.append((etiqueta, X0, Y0, X1, Y1))
            area = max(1, (X1 - X0) * (Y1 - Y0))
            dentro = max(0, min(X1, self.w) - max(X0, 0)) * max(0, min(Y1, self.h) - max(Y0, 0))
            if dentro / area < 0.97:
                self.recortes += 1
        x0, y0, x1, y1 = max(0, X0), max(0, Y0), min(self.w, X1), min(self.h, Y1)
        if x1 <= x0 or y1 <= y0:
            return
        M2 = M.copy()
        M2[0, 2] -= x0
        M2[1, 2] -= y0
        roi = cv2.warpAffine(s, M2, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0)) * alpha
        dst = self.f[y0:y1, x0:x1]
        dst[:] = roi[..., :3] + dst * (1 - roi[..., 3:4])


@lru_cache(maxsize=64)
def imagen(ruta: str, ancho: int, borde_papel: int = 0, sombra: bool = False) -> np.ndarray:
    """Carga una imagen como RGBA premultiplicado. Si tiene fondo verde croma lo recorta."""
    bgr = cv2.imread(ruta, cv2.IMREAD_UNCHANGED)
    if bgr is None:
        raise FileNotFoundError(ruta)
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    alpha = bgr[..., 3].astype(np.float32) / 255 if bgr.shape[2] == 4 else None
    rgb = cv2.cvtColor(bgr[..., :3], cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    if alpha is None:
        esquinas = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3), rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
        r, g, b = esquinas.mean(0)
        if g > 0.5 and g > r * 1.6 and g > b * 1.6:  # fondo croma
            key = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
            alpha = 1 - np.clip((key - 0.12) / 0.25, 0, 1)
            alpha = cv2.GaussianBlur(cv2.erode(alpha, np.ones((3, 3), np.uint8)), (0, 0), 1.0)
            rgb[..., 1] = np.where(key > 0, np.maximum(rgb[..., 0], rgb[..., 2]) + 0.15 * key, rgb[..., 1])
            ys, xs = np.nonzero(alpha > 0.05)
            if len(ys):
                rgb, alpha = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1], alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        else:
            alpha = np.ones(rgb.shape[:2], np.float32)
    esc = ancho / rgb.shape[1]
    rgb = cv2.resize(np.clip(rgb, 0, 1), None, fx=esc, fy=esc, interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(alpha, None, fx=esc, fy=esc, interpolation=cv2.INTER_AREA)
    if borde_papel:  # borde blanco de recorte de papel
        p = borde_papel
        rgb = cv2.copyMakeBorder(rgb, p, p, p, p, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        alpha = cv2.copyMakeBorder(alpha, p, p, p, p, cv2.BORDER_CONSTANT, value=0)
        grueso = cv2.dilate((alpha > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * p + 1, 2 * p + 1))).astype(np.float32)
        grueso = cv2.GaussianBlur(grueso, (0, 0), 1.0)
        rgb = rgb * alpha[..., None] + (1 - alpha[..., None]) * np.float32(0.97)
        alpha = np.maximum(alpha, grueso)
    spr = premul(rgb, alpha)
    if sombra:
        h, w = alpha.shape
        p = max(8, w // 25)
        out = np.zeros((h + 3 * p, w + 3 * p, 4), np.float32)
        s = cv2.GaussianBlur(alpha, (0, 0), p / 2) * 0.45
        out[p + p // 2:p + p // 2 + h, p + p // 3:p + p // 3 + w, 3] = s
        dst = out[p:p + h, p:p + w]
        dst[:] = spr + dst * (1 - spr[..., 3:4])
        spr = out
    return spr


def ken_burns(img: np.ndarray, p: float, w: int, h: int, modo: str = 'acercar') -> np.ndarray:
    """Recorta y escala una imagen RGB (float32) para llenar w x h con movimiento suave."""
    ih, iw = img.shape[:2]
    base = max(w / iw, h / ih)
    if modo == 'alejar':
        z, dx = 1.12 - 0.12 * p, 0.0
    elif modo == 'paneo':
        z, dx = 1.1, (p - 0.5) * 0.06
    else:
        z, dx = 1.0 + 0.12 * p, 0.0
    s = base * z
    M = np.float32([[s, 0, w / 2 - s * iw / 2 + dx * w], [0, s, h / 2 - s * ih / 2]])
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def anillos(lienzo: Lienzo, color: np.ndarray, t: float):
    """Anillos concéntricos que se expanden (fondo de 'revelado de producto')."""
    m = np.zeros((lienzo.h, lienzo.w), np.float32)
    cx, cy = lienzo.w // 2, int(lienzo.h * 0.45)
    for k in range(5):
        r = int((0.12 + 0.16 * k + 0.05 * math.sin(t * 2 + k)) * lienzo.w)
        cv2.circle(m, (cx, cy), r, 1.0, max(2, lienzo.w // 160), cv2.LINE_AA)
    lienzo.f[:] = lienzo.f * (1 - m[..., None] * 0.35) + color * m[..., None] * 0.35
