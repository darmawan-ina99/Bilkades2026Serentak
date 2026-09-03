// Pilkades API - Backend Function
// Handles all SaaS operations: register desa, manage kandidat, manage saksi, submit suara, get tabulasi

export default async function pilkadesApi(req: any) {
  const { action, payload } = req.body || req;
  const b = base44.asServiceRole;

  try {
    switch (action) {

      // ============ REGISTER / LOGIN DESA ============
      case 'registerDesa': {
        const { nama_desa, nama_kandidat_tim, kode_admin } = payload;
        
        // Check if kode_admin already exists
        const existing = await b.entities.Desa.list({ filter: { kode_admin } });
        if (existing.length > 0) {
          return { success: true, desa: existing[0], message: 'Login berhasil' };
        }
        
        // Create new desa
        const desa = await b.entities.Desa.create({
          nama_desa,
          nama_kandidat_tim,
          kode_admin,
          admin_wa_number: '',
          total_tps: 0,
          status: 'active'
        });
        
        return { success: true, desa, message: 'Desa berhasil didaftarkan' };
      }

      case 'loginSaksi': {
        const { kode_admin, nomor_tps, nama_saksi } = payload;
        const desaList = await b.entities.Desa.list({ filter: { kode_admin } });
        if (desaList.length === 0) {
          return { success: false, message: 'Kkode tim tidak ditemukan' };
        }
        const desa = desaList[0];
        
        // Check if saksi exists for this TPS
        const saksiList = await b.entities.SaksiTPS.list({ 
          filter: { desa_id: desa.id, nomor_tps: Number(nomor_tps) } 
        });
        
        let saksi;
        if (saksiList.length > 0) {
          saksi = saksiList[0];
          await b.entities.SaksiTPS.update(saksi.id, { nama_saksi });
        } else {
          // Auto-register saksi
          saksi = await b.entities.SaksiTPS.create({
            desa_id: desa.id,
            nama_saksi,
            nomor_tps: Number(nomor_tps),
            nomor_wa: '',
            status_submit: 'pending'
          });
        }
        
        // Get kandidat list for this desa
        const calonList = await b.entities.KandidatCalon.list({ 
          filter: { desa_id: desa.id } 
        });
        
        return { success: true, desa, saksi, calonList };
      }

      // ============ MANAGE KANDIDAT ============
      case 'addKandidat': {
        const { desa_id, no_urut, nama_calon } = payload;
        const kandidat = await b.entities.KandidatCalon.create({
          desa_id,
          no_urut: Number(no_urut),
          nama_calon,
          visi: ''
        });
        return { success: true, kandidat };
      }

      case 'removeKandidat': {
        const { kandidat_id } = payload;
        await b.entities.KandidatCalon.delete(kandidat_id);
        return { success: true };
      }

      case 'getKandidat': {
        const { desa_id } = payload;
        const calonList = await b.entities.KandidatCalon.list({ filter: { desa_id } });
        calonList.sort((a: any, b: any) => a.no_urut - b.no_urut);
        return { success: true, calonList };
      }

      // ============ MANAGE SAKSI ============
      case 'addSaksi': {
        const { desa_id, nama_saksi, nomor_tps, nomor_wa } = payload;
        const saksi = await b.entities.SaksiTPS.create({
          desa_id,
          nama_saksi,
          nomor_tps: Number(nomor_tps),
          nomor_wa: nomor_wa || '',
          status_submit: 'pending'
        });
        return { success: true, saksi };
      }

      case 'removeSaksi': {
        const { saksi_id } = payload;
        await b.entities.SaksiTPS.delete(saksi_id);
        return { success: true };
      }

      case 'getSaksi': {
        const { desa_id } = payload;
        const saksiList = await b.entities.SaksiTPS.list({ filter: { desa_id } });
        saksiList.sort((a: any, b: any) => a.nomor_tps - b.nomor_tps);
        return { success: true, saksiList };
      }

      // ============ UPDATE ADMIN WA ============
      case 'updateAdminWa': {
        const { desa_id, admin_wa_number } = payload;
        await b.entities.Desa.update(desa_id, { admin_wa_number });
        return { success: true };
      }

      // ============ SUBMIT SUARA ============
      case 'submitSuara': {
        const { desa_id, nomor_tps, suara_per_kandidat, suara_tidak_sah, dpt_total, submitted_by, foto_c1_url } = payload;
        
        // Calculate total sah
        const total_sah = Object.values(suara_per_kandidat).reduce((a: number, b: any) => a + Number(b), 0);
        
        // Check if already submitted
        const existing = await b.entities.SuaraTPS.list({
          filter: { desa_id, nomor_tps: Number(nomor_tps) }
        });
        
        let suara;
        if (existing.length > 0) {
          // Update existing
          suara = await b.entities.SuaraTPS.update(existing[0].id, {
            suara_per_kandidat,
            suara_tidak_sah: Number(suara_tidak_sah),
            dpt_total: Number(dpt_total),
            total_sah,
            submitted_by,
            foto_c1_url: foto_c1_url || existing[0].foto_c1_url || '',
            timestamp: new Date().toISOString()
          });
        } else {
          // Create new
          suara = await b.entities.SuaraTPS.create({
            desa_id,
            nomor_tps: Number(nomor_tps),
            suara_per_kandidat,
            suara_tidak_sah: Number(suara_tidak_sah),
            dpt_total: Number(dpt_total),
            total_sah,
            submitted_by,
            foto_c1_url: foto_c1_url || '',
            timestamp: new Date().toISOString()
          });
        }
        
        // Update saksi status
        const saksiList = await b.entities.SaksiTPS.list({
          filter: { desa_id, nomor_tps: Number(nomor_tps) }
        });
        if (saksiList.length > 0) {
          await b.entities.SaksiTPS.update(saksiList[0].id, { status_submit: 'submitted' });
        }
        
        return { success: true, suara, total_sah };
      }

      // ============ GET TABULASI (REAL-TIME) ============
      case 'getTabulasi': {
        const { desa_id } = payload;
        
        const [desa, calonList, saksiList, suaraList] = await Promise.all([
          b.entities.Desa.get(desa_id),
          b.entities.KandidatCalon.list({ filter: { desa_id } }),
          b.entities.SaksiTPS.list({ filter: { desa_id } }),
          b.entities.SuaraTPS.list({ filter: { desa_id } })
        ]);
        
        calonList.sort((a: any, b: any) => a.no_urut - b.no_urut);
        saksiList.sort((a: any, b: any) => a.nomor_tps - b.nomor_tps);
        suaraList.sort((a: any, b: any) => a.nomor_tps - b.nomor_tps);
        
        // Aggregate suara per kandidat
        const tabulasi: any = {};
        calonList.forEach((c: any) => {
          tabulasi[c.id] = { 
            kandidat: c, 
            total_suara: 0,
            persentase: 0
          };
        });
        
        let totalSah = 0;
        let totalTidakSah = 0;
        let totalDpt = 0;
        
        suaraList.forEach((s: any) => {
          totalSah += s.total_sah || 0;
          totalTidakSah += s.suara_tidak_sah || 0;
          totalDpt += s.dpt_total || 0;
          
          if (s.suara_per_kandidat) {
            Object.entries(s.suara_per_kandidat).forEach(([kandidatId, val]: [string, any]) => {
              if (tabulasi[kandidatId]) {
                tabulasi[kandidatId].total_suara += Number(val);
              }
            });
          }
        });
        
        // Calculate percentages
        Object.values(tabulasi).forEach((t: any) => {
          t.persentase = totalSah > 0 ? Math.round(t.total_suara / totalSah * 100) : 0;
        });
        
        const partisipasi = totalDpt > 0 ? Math.round((totalSah + totalTidakSah) / totalDpt * 100) : 0;
        
        return {
          success: true,
          desa,
          calonList,
          saksiList,
          suaraList,
          tabulasi,
          stats: {
            tps_input: suaraList.length,
            total_sah: totalSah,
            total_tidak_sah: totalTidakSah,
            total_dpt: totalDpt,
            partisipasi
          }
        };
      }

      default:
        return { success: false, message: 'Action tidak dikenal: ' + action };
    }
  } catch (err: any) {
    return { success: false, message: err.message || 'Server error', error: err.stack };
  }
}
