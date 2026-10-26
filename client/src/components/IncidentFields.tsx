import React from 'react';
import { NATURE_OF_DAMAGE_DRY, NATURE_OF_DAMAGE_REEFER } from '../constants/referenceData';

interface IncidentFieldsProps {
  dateOfIncident: string;
  placeOfIncident: string;
  cargoType: string;
  natureOfDamageType: string;
  incidentDescription: string;
  onChange: (fields: Partial<{
    date_of_incident: string;
    place_of_incident: string;
    cargo_type: string;
    nature_of_damage_type: string;
    incident_description: string;
  }>) => void;
  readOnly?: boolean;
}

export const IncidentFields: React.FC<IncidentFieldsProps> = ({
  dateOfIncident,
  placeOfIncident,
  cargoType,
  natureOfDamageType,
  incidentDescription,
  onChange,
  readOnly = false,
}) => {
  const damageOptions = cargoType === 'reefer' ? NATURE_OF_DAMAGE_REEFER : NATURE_OF_DAMAGE_DRY;

  const handleCargoTypeChange = (newType: string) => {
    // Rule 1: Changing cargo type resets nature_of_damage_type
    onChange({
      cargo_type: newType,
      nature_of_damage_type: '',
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Date of Incident */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Date of Incident <span className="text-rose-500">*</span>
          </label>
          <input
            type="date"
            disabled={readOnly}
            value={dateOfIncident ? dateOfIncident.split('T')[0] : ''}
            onChange={(e) => onChange({ date_of_incident: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
          />
        </div>

        {/* Place of Incident */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Place of Incident <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            disabled={readOnly}
            placeholder="e.g. Destination Port Terminal"
            value={placeOfIncident || ''}
            onChange={(e) => onChange({ place_of_incident: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
          />
        </div>

        {/* Cargo Type */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Cargo Type <span className="text-rose-500">*</span>
          </label>
          <select
            disabled={readOnly}
            value={cargoType || 'dry'}
            onChange={(e) => handleCargoTypeChange(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
          >
            <option value="dry">Dry</option>
            <option value="reefer">Reefer</option>
          </select>
        </div>

        {/* Nature of Damage */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Nature of Damage <span className="text-rose-500">*</span>
          </label>
          <select
            disabled={readOnly}
            value={natureOfDamageType || ''}
            onChange={(e) => onChange({ nature_of_damage_type: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
          >
            <option value="">Select damage nature...</option>
            {damageOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Incident Description */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Incident Description <span className="text-rose-500">*</span>
        </label>
        <textarea
          rows={3}
          disabled={readOnly}
          placeholder="Provide detailed description of the incident, packaging conditions, observed damage..."
          value={incidentDescription || ''}
          onChange={(e) => onChange({ incident_description: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>
    </div>
  );
};
