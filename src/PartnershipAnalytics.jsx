import { useState, useEffect } from 'react';
import usePortfolioStore from './portfolioStore';
import CurrentPartnershipGrid from './components/CurrentPartnershipGrid';

const PartnershipAnalytics = () => {
  const { 
    partners, 
    selectedPartner, 
    fetchPartners, 
    setSelectedPartner 
  } = usePortfolioStore();

  const [showTransitionView, setShowTransitionView] = useState(false);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const handlePartnerClick = (partner) => {
    setSelectedPartner(partner);
  };

  const handleClosePartnerDetail = () => {
    setSelectedPartner(null);
  };

  return (
    <div className="space-y-6">
      <CurrentPartnershipGrid 
        partners={partners}
        onPartnerClick={handlePartnerClick}
      />

      {/* Simple modal for partner details - placeholder for Sheet component */}
      {selectedPartner && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{selectedPartner.name}</h3>
              <button 
                onClick={handleClosePartnerDetail}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              <p><strong>Revenue:</strong> ${(selectedPartner.totalRevenue / 1000000).toFixed(1)}M</p>
              <p><strong>Clients:</strong> {selectedPartner.clientCount}</p>
              <p><strong>Capacity:</strong> {Math.round(selectedPartner.capacityUsed)}%</p>
              <p><strong>Avg Strategic Value:</strong> {selectedPartner.avgStrategicValue.toFixed(1)}</p>
              <p><strong>Practice Areas:</strong> {selectedPartner.practiceAreas.join(', ')}</p>
            </div>
          </div>
        </div>
      )}

      {/* TODO: Post-Transition View */}
      {showTransitionView && (
        <div className="mt-8">
          {/* TODO: Implement transition modeling interface */}
        </div>
      )}
    </div>
  );
};

export default PartnershipAnalytics;