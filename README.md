# Bilkades 2026 Serentak

SaaS Tabulasi Suara Pilkades Serentak - Production Version

## Fitur
1. Multi-tenant SaaS (setiap desa punya database terpisah)
2. Login Saksi per TPS - input suara real-time
3. Dashboard Admin - grafik live, rekapitulasi, detail per TPS
4. Export PDF Rekapitulasi
5. Kamera foto C1 dari saksi
6. Integrasi WhatsApp - foto C1 dikirim ke nomor WA admin
7. Setup calon kandidat & manajemen saksi
8. Auto-refresh 3 detik untuk real-time data

## Teknologi
- Frontend: HTML5 + Tailwind CSS + Chart.js + jsPDF
- Backend: Base44 Backend Functions (Deno)
- Database: Base44 Entities (Desa, KandidatCalon, SaksiTPS, SuaraTPS)
- Real-time: Polling API setiap 3 detik
- API Endpoint: Base44 serverless functions

## Cara Pakai
1. Admin: Daftar dengan kode admin unik + nama desa
2. Tambah calon kandidat (nama + no urut)
3. Tambah saksi per TPS (nama + no TPS + no WA)
4. Bagikan kode admin ke saksi untuk login
5. Saksi login -> input suara -> foto C1 -> kirim
6. Admin lihat dashboard update real-time
7. Export PDF untuk laporan

## API
Backend function: pilkadesApi
Actions: registerDesa, loginSaksi, addKandidat, removeKandidat, addSaksi, removeSaksi, submitSuara, getTabulasi, updateAdminWa

(c) 2026 Dharma-Labs
