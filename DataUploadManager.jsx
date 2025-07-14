import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  Download
} from 'lucide-react';
import usePortfolioStore from '../store/portfolioStore';

const DataUploadManager = () => {
  const {
    clients,
    isUploading,
    uploadError,
    setClients,
    setOriginalClients,
    setUploadState,
    setCurrentView
  } = usePortfolioStore();

  const [uploadProgress, setUploadProgress] = useState(0);

  const processCSVData = async (csvData) => {
    try {
      setUploadState(true);
      setUploadProgress(25);

      // Send to backend for processing
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
      const response = await fetch(`${apiBaseUrl}/api/data/process-csv`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csvData }),
      });

      setUploadProgress(75);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        setClients(result.data.clients);
        setOriginalClients(result.data.clients);
        setUploadProgress(100);
        
        // Auto-navigate to dashboard after successful upload
        setTimeout(() => {
          setCurrentView('dashboard');
          setUploadState(false);
          setUploadProgress(0);
        }, 1000);
      } else {
        throw new Error(result.error || 'Processing failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadState(false, error.message);
      setUploadProgress(0);
    }
  };

  const onDrop = useCallback((acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      Papa.parse(file, {
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            processCSVData(results.data);
          }
        },
        header: true,
        skipEmptyLines: true
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.csv']
    },
    multiple: false
  });

  const downloadSampleCSV = () => {
    const sampleData = `CLIENT,Contract Period,2023 Contract Value,2024 Contract Value,Hours/Month,Practice Area,Relationship Strength,Conflict Risk,Time Commitment,Renewal Probability,Strategic Fit Score,Notes
Pfizer,Multi-year,150000,165000,40,Healthcare,8,Low,High,85,9,Major pharmaceutical client with strong relationship
Eversource,Annual,75000,82000,25,Energy,7,Medium,Medium,75,7,Utility company with regulatory focus
50CAN,Project-based,45000,48000,15,Non-profit,9,Low,Low,90,8,Advocacy organization with mission alignment
Gaffney Bennett,Retainer,167000,175000,80,Legal,6,High,High,60,6,Law firm with potential conflicts`;
    
    const blob = new Blob([sampleData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample-client-data.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const hasData = clients && clients.length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Client Data Upload
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasData ? (
            <>
              <div className="text-center space-y-4">
                <Button 
                  onClick={downloadSampleCSV}
                  variant="outline"
                  className="mb-4"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Sample CSV
                </Button>
                
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragActive 
                      ? 'border-blue-400 bg-blue-50' 
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  {isDragActive ? (
                    <p className="text-lg">Drop the CSV file here...</p>
                  ) : (
                    <div>
                      <p className="text-lg mb-2">Drag & drop a CSV file here, or click to select</p>
                      <p className="text-sm text-gray-500">
                        Upload your client portfolio data to get started with analysis
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {isUploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Processing...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <Alert variant="destructive">
                  <AlertDescription>{uploadError}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Data Successfully Loaded</span>
              </div>
              
              <div className="flex items-center justify-center gap-4">
                <Badge variant="secondary">
                  <FileText className="h-3 w-3 mr-1" />
                  {clients.length} clients loaded
                </Badge>
              </div>

              <div className="space-y-2">
                <Button 
                  onClick={() => setCurrentView('dashboard')}
                  className="w-full"
                >
                  View Dashboard
                </Button>
                
                <Button 
                  onClick={() => {
                    setClients([]);
                    setOriginalClients([]);
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Upload New Data
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DataUploadManager;

