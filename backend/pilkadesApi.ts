// Pilkades API v2 - Hardened
// Auth: kode_admin (ketua, aksi penuh) + kode_saksi (auto-generate, buat saksi input saja)
// Semua aksi diverifikasi server-side. Kode admin TIDAK pernah dikirim ke saksi.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const RATE_LIMIT_MAX = 40; // per kode per menit (best-effort per instance)
const rateBuckets: Record<string, { count: number; reset: number }> = {};

function checkRate(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets[key];
  if (!b || now > b.reset) { rateBuckets[key] = { count: 1, reset: now + 60000 }; return true; }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}
function s(v: any, max = 60): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function n(v: any, min = 0, max = 999999999): number {
  const x = Number(v);
  if (!isFinite(x)) return 0;
  return Math.max(min, Math.min(max, Math.round(x)));
}
function validKode(k: any): boolean {
  const str = s(k, 24);
  return /^[A-Za-z0-9]{4,24}$/.test(str);
}
function genKodeSaksi(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function mapDesa(d: any, includeAdmin = true): any {
  const out: any = {
    id: d.id, nama_desa: d.nama_desa, nama_tim: d.nama_tim,
    nama_kandidat_tim: d.nama_tim, total_tps: d.total_tps || 0,
    tanggal_pilkades: d.tanggal_pilkades || '', status: d.status || 'active',
    admin_wa: d.admin_wa || '', admin_wa_number: d.admin_wa || '',
    latitude: d.latitude ?? null, longitude: d.longitude ?? null
  };
  if (includeAdmin) { out.kode_admin = d.kode_admin; out.kode_saksi = d.kode_saksi; }
  else { out.kode_saksi = d.kode_saksi; }
  return out;
}
function mapKandidat(k: any): any {
  return { id: k.id, desa_id: k.desa_id, no_urut: k.no_urut, nama_calon: k.nama_calon, nama_wakil: k.nama_wakil || '', visi: '' };
}
function mapSuara(x: any): any {
  return {
    id: x.id, desa_id: x.desa_id, nomor_tps: x.nomor_tps,
    suara_per_kandidat: x.suara_per_kandidat, suara_tidak_sah: x.suara_tidak_sah,
    dpt_total: x.dpt_total, total_sah: x.total_sah, submitted_by: x.submitted_by,
    foto_c1_url: x.foto_c1 || '', timestamp: x.timestamp
  };
}
function fail(message: string) { return { success: false, message }; }
function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json(fail('Metode tidak didukung'), 405);

  let action = '', payload: any = {};
  try {
    const body = await req.json();
    action = s(body.action, 40);
    payload = body.payload || {};
  } catch {
    return json(fail('Body JSON tidak valid'), 400);
  }
  const p = payload;

  try {
    const base44 = createClientFromRequest(req);
    const b = base44.asServiceRole;

    const findDesaByKode = async (kode: string) => {
      if (!validKode(kode)) return null;
      let list = await b.entities.DesaPilkades.filter({ kode_admin: kode });
      if (list.length > 0) return { desa: list[0], role: 'admin' as const };
      list = await b.entities.DesaPilkades.filter({ kode_saksi: kode });
      if (list.length > 0) return { desa: list[0], role: 'saksi' as const };
      return null;
    };

    switch (action) {

      // ===== DAFTAR / LOGIN TIM =====
      case 'registerDesa': {
        const nama_desa = s(p.nama_desa, 60);
        const nama_tim = s(p.nama_kandidat_tim || p.nama_tim, 60);
        const kode_admin = s(p.kode_admin, 24);
        if (nama_desa.length < 3) return json(fail('Nama desa/tim minimal 3 karakter'));
        if (!validKode(kode_admin)) return json(fail('Kode tim harus 4-24 huruf/angka'));
        if (!checkRate('reg:' + kode_admin)) return json(fail('Terlalu banyak percobaan. Coba lagi sebentar.'));

        const existing = await b.entities.DesaPilkades.filter({ kode_admin });
        if (existing.length > 0) {
          return json({ success: true, desa: mapDesa(existing[0], true), message: 'Login berhasil' });
        }

        let kode_saksi = genKodeSaksi();
        for (let i = 0; i < 5; i++) {
          const dupe = await b.entities.DesaPilkades.filter({ kode_saksi });
          if (dupe.length === 0) break;
          kode_saksi = genKodeSaksi();
        }

        const desa = await b.entities.DesaPilkades.create({
          nama_desa, nama_tim, kode_admin, kode_saksi,
          admin_wa: '', total_tps: 0, tanggal_pilkades: '', status: 'active'
        });
        return json({ success: true, desa: mapDesa(desa, true), message: 'Tim berhasil didaftarkan' });
      }

      // ===== LOGIN SAKSI (kode admin ATAU kode saksi) =====
      case 'loginSaksi': {
        const kode = s(p.kode_admin || p.kode, 24);
        const nomor_tps = n(p.nomor_tps, 1, 999);
        const nama_saksi = s(p.nama_saksi, 60);
        if (!validKode(kode)) return json(fail('Kode tidak valid'));
        if (!nomor_tps) return json(fail('Nomor TPS harus diisi angka 1-999'));
        if (nama_saksi.length < 2) return json(fail('Nama saksi minimal 2 karakter'));
        if (!checkRate('saksi:' + kode)) return json(fail('Terlalu banyak percobaan. Coba lagi sebentar.'));

        const found = await findDesaByKode(kode);
        if (!found) return json(fail('Kode tim tidak ditemukan'));
        const desa = found.desa;

        const saksiList = await b.entities.SaksiPilkades.filter({ desa_id: desa.id, nomor_tps });
        let saksi;
        if (saksiList.length > 0) {
          saksi = saksiList[0];
          await b.entities.SaksiPilkades.update(saksi.id, { nama_saksi });
        } else {
          saksi = await b.entities.SaksiPilkades.create({
            desa_id: desa.id, nama_saksi, nomor_tps, nomor_wa: '', status_submit: 'pending'
          });
        }

        const calonList = await b.entities.KandidatPilkades.filter({ desa_id: desa.id });
        calonList.sort((a: any, c: any) => a.no_urut - c.no_urut);

        // ke saksi JANGAN kirim kode_admin
        return json({ success: true, desa: mapDesa(desa, false), saksi, calonList: calonList.map(mapKandidat) });
      }

      // ===== KANDIDAT (admin only) =====
      case 'addKandidat': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const no_urut = n(p.no_urut, 1, 99);
        const nama_calon = s(p.nama_calon, 60);
        if (!no_urut) return json(fail('Nomor urut harus 1-99'));
        if (nama_calon.length < 2) return json(fail('Nama calon minimal 2 karakter'));
        const kandidat = await b.entities.KandidatPilkades.create({
          desa_id: found.desa.id, no_urut, nama_calon, nama_wakil: s(p.nama_wakil, 60)
        });
        return json({ success: true, kandidat: mapKandidat(kandidat) });
      }

      case 'removeKandidat': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        const k = await b.entities.KandidatPilkades.get(p.kandidat_id).catch(() => null);
        if (!k || k.desa_id !== found.desa.id) return json(fail('Data tidak ditemukan'));
        await b.entities.KandidatPilkades.delete(p.kandidat_id);
        return json({ success: true });
      }

      case 'getKandidat': {
        const found = await findDesaByKode(p.kode_admin || p.kode);
        if (!found) return json(fail('Kode tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const calonList = await b.entities.KandidatPilkades.filter({ desa_id: found.desa.id });
        calonList.sort((a: any, c: any) => a.no_urut - c.no_urut);
        return json({ success: true, calonList: calonList.map(mapKandidat) });
      }

      // ===== SAKSI (dikelola admin) =====
      case 'addSaksi': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const nomor_tps = n(p.nomor_tps, 1, 999);
        const nama_saksi = s(p.nama_saksi, 60);
        if (!nomor_tps) return json(fail('Nomor TPS harus 1-999'));
        if (nama_saksi.length < 2) return json(fail('Nama saksi minimal 2 karakter'));
        const saksi = await b.entities.SaksiPilkades.create({
          desa_id: found.desa.id, nama_saksi, nomor_tps,
          nomor_wa: s(p.nomor_wa, 20).replace(/[^0-9+]/g, ''), status_submit: 'pending'
        });
        return json({ success: true, saksi });
      }

      case 'removeSaksi': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        const sk = await b.entities.SaksiPilkades.get(p.saksi_id).catch(() => null);
        if (!sk || sk.desa_id !== found.desa.id) return json(fail('Data tidak ditemukan'));
        await b.entities.SaksiPilkades.delete(p.saksi_id);
        return json({ success: true });
      }

      case 'getSaksi': {
        const found = await findDesaByKode(p.kode_admin || p.kode);
        if (!found) return json(fail('Kode tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const saksiList = await b.entities.SaksiPilkades.filter({ desa_id: found.desa.id });
        saksiList.sort((a: any, c: any) => a.nomor_tps - c.nomor_tps);
        return json({ success: true, saksiList });
      }

      // ===== UPDATE WA ADMIN =====
      case 'updateAdminWa': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const wa = s(p.admin_wa_number, 20).replace(/[^0-9+]/g, '');
        await b.entities.DesaPilkades.update(found.desa.id, { admin_wa: wa });
        return json({ success: true });
      }

      // ===== INPUT SUARA (kode saksi ATAU kode admin) =====
      case 'submitSuara': {
        const kode = s(p.kode_admin || p.kode, 24);
        if (!validKode(kode)) return json(fail('Kode tidak valid'));
        if (!checkRate('submit:' + kode)) return json(fail('Terlalu banyak pengiriman. Coba lagi sebentar.'));
        const found = await findDesaByKode(kode);
        if (!found) return json(fail('Kode tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const desa = found.desa;

        const nomor_tps = n(p.nomor_tps, 1, 999);
        if (!nomor_tps) return json(fail('Nomor TPS harus 1-999'));
        const suara_per_kandidat: Record<string, number> = {};
        let total_sah = 0;
        const entries = p.suara_per_kandidat || {};
        for (const [kid, val] of Object.entries(entries)) {
          const v = n(val, 0, 100000);
          suara_per_kandidat[kid] = v;
          total_sah += v;
        }
        const suara_tidak_sah = n(p.suara_tidak_sah, 0, 100000);
        const dpt_total = n(p.dpt_total, 0, 100000);

        const existing = await b.entities.SuaraPilkades.filter({ desa_id: desa.id, nomor_tps });

        const submitted_by = s(p.submitted_by, 60);
        const now = new Date().toISOString();
        let suara;
        if (existing.length > 0) {
          suara = await b.entities.SuaraPilkades.update(existing[0].id, {
            suara_per_kandidat, suara_tidak_sah, dpt_total, total_sah,
            submitted_by, foto_c1: s(p.foto_c1_url, 300), timestamp: now
          });
        } else {
          suara = await b.entities.SuaraPilkades.create({
            desa_id: desa.id, nomor_tps, suara_per_kandidat, suara_tidak_sah,
            dpt_total, total_sah, submitted_by, foto_c1: s(p.foto_c1_url, 300),
            timestamp: now
          });
        }

        const saksiList = await b.entities.SaksiPilkades.filter({ desa_id: desa.id, nomor_tps });
        if (saksiList.length > 0) {
          await b.entities.SaksiPilkades.update(saksiList[0].id, { status_submit: 'submitted', waktu_submit: now });
        }

        return json({ success: true, suara: mapSuara(suara), total_sah });
      }

      // ===== TABULASI REAL-TIME (kode admin ATAU kode saksi) =====
      case 'getTabulasi': {
        const kode = s(p.kode_admin || p.kode, 24);
        if (!validKode(kode)) return json(fail('Kode tidak valid'));
        const found = await findDesaByKode(kode);
        if (!found) return json(fail('Kode tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const desa = found.desa;

        const [calonList, saksiList, suaraList] = await Promise.all([
          b.entities.KandidatPilkades.filter({ desa_id: desa.id }),
          b.entities.SaksiPilkades.filter({ desa_id: desa.id }),
          b.entities.SuaraPilkades.filter({ desa_id: desa.id })
        ]);
        calonList.sort((a: any, c: any) => a.no_urut - c.no_urut);
        saksiList.sort((a: any, c: any) => a.nomor_tps - c.nomor_tps);
        suaraList.sort((a: any, c: any) => a.nomor_tps - c.nomor_tps);

        const tabulasi: any = {};
        calonList.forEach((c: any) => {
          tabulasi[c.id] = { kandidat: mapKandidat(c), total_suara: 0, persentase: 0 };
        });

        let totalSah = 0, totalTidakSah = 0, totalDpt = 0;
        suaraList.forEach((x: any) => {
          totalSah += x.total_sah || 0;
          totalTidakSah += x.suara_tidak_sah || 0;
          totalDpt += x.dpt_total || 0;
          if (x.suara_per_kandidat) {
            Object.entries(x.suara_per_kandidat).forEach(([kid, val]: [string, any]) => {
              if (tabulasi[kid]) tabulasi[kid].total_suara += Number(val) || 0;
            });
          }
        });
        Object.values(tabulasi).forEach((t: any) => {
          t.persentase = totalSah > 0 ? Math.round(t.total_suara / totalSah * 100) : 0;
        });
        const partisipasi = totalDpt > 0 ? Math.round((totalSah + totalTidakSah) / totalDpt * 100) : 0;

        return json({
          success: true, desa: mapDesa(desa, found.role === 'admin'),
          calonList: calonList.map(mapKandidat), saksiList, suaraList: suaraList.map(mapSuara),
          tabulasi,
          stats: {
            tps_input: suaraList.length, total_sah: totalSah,
            total_tidak_sah: totalTidakSah, total_dpt: totalDpt, partisipasi
          }
        });
      }

      // ===== PETA LOKASI =====
      case 'geocodeDesa': {
        const q = s(p.nama_desa, 100);
        if (q.length < 3) return json(fail('Isi nama desa'));
        if (!checkRate('geo')) return json(fail('Terlalu banyak pencarian. Coba lagi sebentar.'));
        const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=' + encodeURIComponent(q);
        const resp = await fetch(url, { headers: { 'User-Agent': 'PilkadesPro/2.0' } });
        const data: any = await resp.json();
        if (!Array.isArray(data) || data.length === 0) return json(fail('Lokasi tidak ditemukan'));
        return json({ success: true, display: data[0].display_name, latitude: Number(data[0].lat), longitude: Number(data[0].lon) });
      }

      case 'updateDesaCoordinates': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        if (found.desa.id !== p.desa_id) return json(fail('Akses ditolak'));
        const latitude = Number(p.latitude), longitude = Number(p.longitude);
        if (!isFinite(latitude) || !isFinite(longitude)) return json(fail('Koordinat tidak valid'));
        await b.entities.DesaPilkades.update(found.desa.id, { latitude, longitude });
        return json({ success: true });
      }

      case 'updateTpsCoordinates': {
        const found = await findDesaByKode(p.kode_admin);
        if (!found || found.role !== 'admin') return json(fail('Kode admin tidak valid'));
        const sk = await b.entities.SaksiPilkades.get(p.saksi_id).catch(() => null);
        if (!sk || sk.desa_id !== found.desa.id) return json(fail('Data tidak ditemukan'));
        const latitude = Number(p.latitude), longitude = Number(p.longitude);
        if (!isFinite(latitude) || !isFinite(longitude)) return json(fail('Koordinat tidak valid'));
        await b.entities.SaksiPilkades.update(p.saksi_id, { latitude, longitude });
        return json({ success: true });
      }

      default:
        return json(fail('Action tidak dikenal'));
    }
  } catch (err: any) {
    console.error('pilkadesApi error:', action, err && err.message);
    return json({ success: false, message: 'Terjadi kesalahan server. Coba lagi.' }, 500);
  }
});
