import path from 'path';
import XLSX from 'xlsx';
import db from './db';

export interface LMSDataRecord {
  bl_number: string;
  shipper: string;
  consignee: string;
  notify_party: string;
  place_of_receipt: string;
  port_of_loading: string;
  port_of_discharge: string;
  place_of_delivery: string;
  vessel_code: string;
  vessel_name: string;
  vessel_voyage: string;
  commodity: string;
  discharge_date: string;
  port_of_loading_date: string;
  country: string;
}

export interface ContainerRecord {
  bl_number: string;
  container_number: string;
  container_size: string;
  seal_number: string;
  measure: string;
  weight: number;
  quantity: number;
  package_type: string;
}

let lmsDataMap: Map<string, LMSDataRecord> | null = null;
let containersMap: Map<string, ContainerRecord[]> | null = null;

export function loadLMSExcel() {
  if (lmsDataMap && containersMap) return;

  const excelPath = path.resolve(__dirname, 'data/LMS_Mock_Data.xlsx');
  console.log('Loading LMS data from:', excelPath);

  const workbook = XLSX.readFile(excelPath);
  const lmsSheet = workbook.Sheets['LMS_Data'];
  const containersSheet = workbook.Sheets['Containers'];

  if (!lmsSheet || !containersSheet) {
    throw new Error('LMS_Data or Containers sheet missing in LMS_Mock_Data.xlsx');
  }

  const lmsRows: LMSDataRecord[] = XLSX.utils.sheet_to_json(lmsSheet);
  const containerRows: ContainerRecord[] = XLSX.utils.sheet_to_json(containersSheet);

  lmsDataMap = new Map();
  for (const row of lmsRows) {
    if (row.bl_number) {
      lmsDataMap.set(row.bl_number.trim().toUpperCase(), row);
    }
  }

  containersMap = new Map();
  for (const c of containerRows) {
    if (c.bl_number) {
      const bl = c.bl_number.trim().toUpperCase();
      const list = containersMap.get(bl) || [];
      list.push(c);
      containersMap.set(bl, list);
    }
  }

  console.log(`Loaded ${lmsDataMap.size} BL records and ${containerRows.length} container records.`);
}

export async function fetchLMSByBL(blNumber: string): Promise<any> {
  const blClean = (blNumber || '').trim().toUpperCase();
  if (!blClean) {
    return { error: 'BL number is required' };
  }

  // 1. Check cache first
  const cached = (await db.prepare('SELECT * FROM lms_cache WHERE bl_number = ?').get(blClean)) as {
    bl_number: string;
    lms_data: string;
    containers: string;
    cached_date: string;
  } | undefined;

  if (cached) {
    try {
      const lmsData = JSON.parse(cached.lms_data);
      const containers = JSON.parse(cached.containers);
      return {
        success: true,
        source: 'cache',
        data: lmsData,
        containers: containers,
      };
    } catch {
      // In case of corrupt cache, fall through to excel
    }
  }

  // 2. Fetch from Excel in-memory data
  loadLMSExcel();

  if (!lmsDataMap || !containersMap) {
    return { error: 'LMS data source unavailable' };
  }

  const shipment = lmsDataMap.get(blClean);
  if (!shipment) {
    return { error: `BL not found (${blClean})` };
  }

  const containers = containersMap.get(blClean) || [];

  // 3. Cache the result in PostgreSQL lms_cache
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO lms_cache (bl_number, lms_data, containers, cached_date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (bl_number) DO UPDATE SET
      lms_data = EXCLUDED.lms_data,
      containers = EXCLUDED.containers,
      cached_date = EXCLUDED.cached_date
  `).run(blClean, JSON.stringify(shipment), JSON.stringify(containers), now);

  return {
    success: true,
    source: 'excel',
    data: shipment,
    containers: containers,
  };
}
