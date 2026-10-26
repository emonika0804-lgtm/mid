export const CLAIMANT_TYPES = [
  'Booking Party',
  'Cargo Insurer',
  'Cargo Underwriter',
  "Claimant's Lawyers",
  'Consignee',
  'Crew (PIL)',
  'Crew (Ship Managers)',
  'Hull Underwriter',
  'Notify Party',
  'Others',
  'Pacific International Lines',
  'Port / Terminal',
  'Recovery Agent',
  'Shipper',
  'State Authorities',
  'Stevedore Company',
  'Stevedore Worker',
  'Opponent Vessel',
];

export const EXPENSE_TYPES = [
  'Accommodation',
  'Adjusted Claim Against U/W',
  'Airfare Expenses',
  'Cleaning Expenses',
  'Correspondent Fees',
  'Crew Compensation',
  'Deductible',
  'Disability Compensation',
  'Expert Fees',
  'Fine or Penalty',
  'GA Contribution',
  'Legal Fees',
  'Medical Expenses',
  'Operational Expenses',
  'Others',
  'Professional Fees',
  'Container Repair Cost',
  'Sickness Allowance',
  'Settlement Amount',
  'Settlement Payout',
  'Stowaway Repatriation Cost',
  'Survey Fees',
  'Transportation',
  'Total Expenses',
];

export const RECOVERY_TYPES = [
  'Recovery from Liable Party',
  'Reimbursement from Club',
];

export const RECOVERY_LIABLE_PARTIES = [
  'Carrier (PIL)',
  'Shipper',
  'Consignee',
  'Terminal Operator',
  'Stevedore',
  'Third Party Logistics',
  'Insurance Underwriter',
  'Others',
];

export const POLICY_DEDUCTIBLE_TYPES = [
  'Cargo',
  'Crew',
  'MSC',
  'X NOE',
  'OILPOLLUTION',
  'OTHERS',
  'P&I',
  'SLOT CHARTERED',
  'SOL',
  'STOWAWAY',
  'TIME CHARTERED',
];

export const CLAIMS_HANDLERS = [
  'Alfred',
  'Wei Lin',
  'Xann Tey Xiao Ni',
  'Sri Kabishna',
  'Kerutika',
  'Nuraftin',
];

export const CURRENCIES = ['USD', 'SGD', 'EUR', 'GBP', 'INR', 'AED', 'CNY'];

export const AWAITING_INPUT_REASONS = [
  { value: 'customer', label: 'Customer' },
  { value: 'claimant', label: 'Claimant' },
  { value: 'internal', label: 'Internal' },
  { value: 'pi', label: 'P&I' },
  { value: 'court_case', label: 'Court Case' },
];

export const CLOSED_REASONS = [
  { value: 'settled', label: 'Settled' },
  { value: 'rejected', label: 'Rejected' },
];

export const COURT_CASE_INDICATORS = ['Active', 'Pending', 'Closed', 'On Hold'];

export const COURT_CASE_CHANCE_OPTIONS = ['High', 'Medium', 'Low', 'Uncertain'];

export const NATURE_OF_DAMAGE_DRY = [
  'Abandonment',
  'Container Over Board',
  'Damage by Terminal',
  'Fraud or Cargo Title Disputes',
  'Physical Cargo Damage',
  'Pilferage of Cargo / Seal Discrepancy',
  'Reefer Malfunctioned / Power Outage',
  'Cargo Shortage',
  'SOL',
  'Wet Cargo Damage',
  'Others',
  'Claim under TT Extension Cover',
];

export const NATURE_OF_DAMAGE_REEFER = [
  'Temperature Fluctuation',
  'Malfunction',
  'Delay',
  'Wrong Temperature Setting',
  'Failed CT / CA',
  'Water Ingress',
  'Hot Stuffing',
  'Others',
];

export const MANDATORY_DOCS_DRY_CLAIM = [
  'Bill of Lading (front & reverse page)',
  'Commercial Invoice',
  'Packing List',
  'Claim Statement with Breakdown',
  'Cargo damage photos which are clear and dated with images from multiple angles showing entire damaged cargo',
  "Claimant's Survey Report with Colour Photographs",
  'Salvage Receipt / Destruction Certificate with photos',
  'Cargo damage Photos taken from the container',
  'Container damage photos with visible container number',
  'Letter of Assignment (As applicable)',
  'Subrogation Receipt (As applicable)',
  'Letter of Authority (As applicable)',
  'Marine insurance policy certificate (As applicable)',
];

export const MANDATORY_DOCS_REEFER_CLAIM = [
  ...MANDATORY_DOCS_DRY_CLAIM,
  'Pre-shipment survey report with coloured photographs at the origin',
  'Health certificate (As applicable)',
  'Harvest certificate (As applicable)',
];

export const MANDATORY_DOCS_DRY_SURVEY = [
  'What is the cargo value of the affected cargo?',
  'Photographs of the damaged cargo / container',
  'Packing List',
  'Commercial Invoice',
  'Was the cargo unstuffed from the container',
];

export const MANDATORY_DOCS_REEFER_SURVEY = [
  'Value of affected cargo / estimated loss if available',
  'Photographs or videos of the container and the affected cargo',
  'Photograph of current temperature shown on the display panel',
];

export const CONTAINER_SIZES = [
  '20ft',
  '40ft',
  '40ft HC',
  '45ft',
  '20ft Reefer',
  '40ft Reefer',
  '40ft HC Reefer',
  'Others',
];

export const WORKFLOW_STATUS_ORDER = [
  { key: 'new_claim', label: 'New Claim' },
  { key: 'pre_claim', label: 'Pre-Claim' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'awaiting_input', label: 'Awaiting Input' },
  { key: 'awaiting_approval', label: 'Awaiting Approval' },
  { key: 'closed', label: 'Closed' },
];

export const SURVEY_STATUS_ORDER = [
  { key: 'new_survey', label: 'New Survey' },
  { key: 'appointed', label: 'Appointed' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
];
