import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// import { Alert } from '@/components/ui/alert'; // Alert component not available, using Card instead
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { apiClient } from './api';
import usePortfolioStore from './portfolioStore';

const DataUploadManager = () => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState(null);
  
  const { setClients, fetchClients } = usePortfolioStore();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setError(null);
      setUploadResult(null);
    } else {
      setError('Please select a valid CSV file');
      setFile(null);
    }
  };

  const parseCSV = (csvText) => {
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''));
    
    return lines.slice(1)
      .filter(line => line.trim())
      .map(line => {
        const values = line.split(',').map(value => value.trim().replace(/"/g, ''));
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        return row;
      });
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Read the file content
      const fileContent = await file.text();
      
      // Parse CSV
      const csvData = parseCSV(fileContent);
      
      if (csvData.length === 0) {
        throw new Error('CSV file appears to be empty or invalid');
      }

      // Send to backend for processing
      const response = await apiClient.post('/api/data/process-csv', { csvData });
      
      if (response.success) {
        setUploadResult({
          success: true,
          clientCount: response.clients.length,
          totalRevenue: response.summary.totalRevenue,
          validation: response.validation
        });
        
        // Refresh clients data
        await fetchClients();
      } else {
        throw new Error('Failed to process CSV data');
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to upload and process CSV file');
    } finally {
      setIsUploading(false);
    }
  };

  const expectedColumns = [
    'CLIENT',
    'Contract Period', 
    '2023 Contracts',
    '2024 Contracts', 
    '2025 Contracts'
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Client Data (CSV)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv-file">Choose CSV File</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={isUploading}
            />
          </div>

          {file && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}

          <Button 
            onClick={handleUpload} 
            disabled={!file || isUploading}
            className="w-full"
          >
            {isUploading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Processing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload and Process CSV
              </>
            )}
          </Button>

          {error && (
            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <div>
                    <strong>Error:</strong> {error}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {uploadResult && uploadResult.success && (
            <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" />
                  <div>
                    <strong>Success!</strong> Processed {uploadResult.clientCount} clients with total revenue of ${uploadResult.totalRevenue.toLocaleString()}
                    {uploadResult.validation.issues.length > 0 && (
                      <div className="mt-2">
                        <strong>Issues found:</strong>
                        <ul className="list-disc list-inside text-sm mt-1">
                          {uploadResult.validation.issues.map((issue, index) => (
                            <li key={index}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CSV Format Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your CSV file should contain the following columns:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {expectedColumns.map((column) => (
                <div key={column} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  <code className="bg-muted px-2 py-1 rounded text-xs">{column}</code>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">Example CSV format:</p>
              <code className="text-xs block mt-1">
                CLIENT,Contract Period,2023 Contracts,2024 Contracts,2025 Contracts<br/>
                "Acme Corp","1/1/24-12/31/25","$50,000","$75,000","$100,000"
              </code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DataUploadManager;