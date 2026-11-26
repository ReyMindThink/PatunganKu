// Pembungkus respons sukses (api-contract 5.1). Galat tidak lewat sini: errorHandler.
export function kirim(res, data) {
  return res.status(200).json({ data });
}

export function dibuat(res, data) {
  return res.status(201).json({ data });
}

export function kosong(res) {
  return res.status(204).end();
}

// Daftar berkursor (api-contract 2.5). Tanpa halaman lagi: hasMore false dan nextCursor null.
export function halaman(res, data, { nextCursor = null, hasMore = false } = {}) {
  return res.status(200).json({
    data,
    page: { nextCursor: hasMore ? nextCursor : null, hasMore: Boolean(hasMore) },
  });
}
