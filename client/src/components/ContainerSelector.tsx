import React from 'react';

export interface ContainerItem {
  container_number: string;
  container_size: string;
  seal_number: string;
  measure: string;
  weight: number;
  quantity: number;
  package_type: string;
}

interface ContainerSelectorProps {
  containers: ContainerItem[];
  selectedContainerNumbers: string[];
  onChange: (selected: string[], containersWithSizes: ContainerItem[]) => void;
  readOnly?: boolean;
}

export const ContainerSelector: React.FC<ContainerSelectorProps> = ({
  containers,
  selectedContainerNumbers,
  onChange,
  readOnly = false,
}) => {
  const toggleSelect = (num: string) => {
    if (readOnly) return;
    let next: string[];
    if (selectedContainerNumbers.includes(num)) {
      next = selectedContainerNumbers.filter(n => n !== num);
    } else {
      next = [...selectedContainerNumbers, num];
    }
    const selectedObjs = containers.filter(c => next.includes(c.container_number));
    onChange(next, selectedObjs);
  };

  const toggleSelectAll = () => {
    if (readOnly) return;
    if (selectedContainerNumbers.length === containers.length) {
      onChange([], []);
    } else {
      const allNums = containers.map(c => c.container_number);
      onChange(allNums, containers);
    }
  };

  if (!containers || containers.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-sm">
        No container data available. Please fetch shipment information using a valid BL number.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Containers ({containers.length}) · Selected: <span className="text-blue-600 font-bold">{selectedContainerNumbers.length}</span>
        </span>
        {!readOnly && containers.length > 1 && (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
          >
            {selectedContainerNumbers.length === containers.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3 w-10 text-center">Damaged</th>
              <th className="py-2.5 px-3">Container Number</th>
              <th className="py-2.5 px-3">Seal Number</th>
              <th className="py-2.5 px-3">Measure</th>
              <th className="py-2.5 px-3">Weight (kg)</th>
              <th className="py-2.5 px-3">Quantity</th>
              <th className="py-2.5 px-3">Size</th>
              <th className="py-2.5 px-3">Package Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {containers.map((c) => {
              const isSelected = selectedContainerNumbers.includes(c.container_number);
              return (
                <tr
                  key={c.container_number}
                  onClick={() => !readOnly && toggleSelect(c.container_number)}
                  className={`transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/70 hover:bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={readOnly}
                      onChange={() => toggleSelect(c.container_number)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="py-2.5 px-3 font-medium text-slate-900">{c.container_number}</td>
                  <td className="py-2.5 px-3 text-slate-600">{c.seal_number || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-600">{c.measure || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-600">{c.weight ? c.weight.toLocaleString() : '—'}</td>
                  <td className="py-2.5 px-3 text-slate-600">{c.quantity ?? '—'}</td>
                  <td className="py-2.5 px-3 text-slate-600">{c.container_size || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-600">{c.package_type || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
