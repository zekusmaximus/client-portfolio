import { useState, useEffect } from 'react';
import usePortfolioStore from './portfolioStore';
import CurrentPartnershipGrid from './components/CurrentPartnershipGrid';
import PartnerDeepDive from './components/PartnerDeepDive';
import RedistributionModeler from './components/RedistributionModeler';

const PartnershipAnalytics = () => {
  const { 
    partners, 
    selectedPartner, 
    fetchPartners, 
    setSelectedPartner,
    markPartnerDeparting
  } = usePortfolioStore();

  const [showTransitionView, setShowTransitionView] = useState(false);
  const [redistributionModel, setRedistributionModel] = useState('balanced');

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const handlePartnerClick = (partner) => {
    setSelectedPartner(partner);
  };

  const handlePartnerRightClick = (partner, e) => {
    e.preventDefault();
    markPartnerDeparting(partner.id);
  };

  return (
    <div className="space-y-6">
      <CurrentPartnershipGrid 
        partners={partners}
        onPartnerClick={handlePartnerClick}
        onPartnerRightClick={handlePartnerRightClick}
      />

      <RedistributionModeler 
        model={redistributionModel}
        onModelChange={setRedistributionModel}
      />

      {selectedPartner && (
        <PartnerDeepDive 
          partner={selectedPartner}
          onClose={() => setSelectedPartner(null)}
        />
      )}
    </div>
  );
};

export default PartnershipAnalytics;