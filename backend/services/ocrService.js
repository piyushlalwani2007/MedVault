const axios = require('axios');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const ocrConfig = require('../config/ocr');

class OCRService {
  constructor() {
    this.apiKey = ocrConfig.apiKey;
    this.endpoint = ocrConfig.endpoint;
    this.groqApiKey = ocrConfig.groqApiKey;
  }

  getPreferredProvider() {
    return this.apiKey ? 'google-vision' : 'local';
  }

  // Main OCR function
  async extractFromPrescription(imagePath) {
    try {
      const rawText = await this.runOCR(imagePath);
      const parsedData = this.parsePrescriptionData(rawText);
      const enriched = await this.enrichClinicalSummary(rawText, parsedData);

      return {
        success: true,
        rawText,
        parsedData: enriched,
        confidence: this.calculateConfidence(enriched)
      };
    } catch (error) {
      console.error('OCR Error:', error);
      return {
        success: false,
        error: error.message,
        rawText: ''
      };
    }
  }

  async enrichClinicalSummary(rawText, parsedData = {}) {
    if (!this.groqApiKey) {
      return {
        ...parsedData,
        treatment: parsedData.treatment || '',
        dischargeInstructions: parsedData.dischargeInstructions || ''
      };
    }

    try {
      const prompt = `You are a clinical document assistant. Read this hospital discharge text and return JSON only with these exact keys: diagnosis, treatment, dischargeInstructions. Keep treatment as a concise medical plan and dischargeInstructions as a short patient-safe aftercare summary. Use the text only. If information is missing, use a reasonable clinical default based on context.\n\nTEXT:\n${rawText}`;

      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'openai/gpt-oss-20b',
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'Return valid JSON only.' },
            { role: 'user', content: prompt }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${this.groqApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data?.choices?.[0]?.message?.content || '';
      const cleaned = content.replace(/```json|```/gi, '').trim();
      const result = JSON.parse(cleaned);

      return {
        ...parsedData,
        diagnosis: result.diagnosis || parsedData.diagnosis || '',
        treatment: result.treatment || parsedData.treatment || '',
        dischargeInstructions: result.dischargeInstructions || parsedData.dischargeInstructions || ''
      };
    } catch (error) {
      console.warn('Groq enrichment failed, using OCR-only values:', error.response?.data || error.message);
      return {
        ...parsedData,
        treatment: parsedData.treatment || '',
        dischargeInstructions: parsedData.dischargeInstructions || ''
      };
    }
  }

  async runOCR(imagePath) {
    if (this.apiKey) {
      try {
        return await this.callGoogleVisionAPI(imagePath);
      } catch (error) {
        console.warn('Google Vision failed, falling back to local OCR:', error.message);
      }
    }

    return await this.callLocalOCR(imagePath);
  }

  async callLocalOCR(imagePath) {
    try {
      const { data } = await Tesseract.recognize(imagePath, 'eng', {
        logger: () => {}
      });

      if (!data || !data.text) {
        throw new Error('Local OCR did not return any readable text.');
      }

      return data.text;
    } catch (error) {
      throw new Error(`Local OCR failed: ${error.message}`);
    }
  }

  async callGoogleVisionAPI(imagePath) {
    try {
      if (!this.apiKey) {
        throw new Error('GOOGLE_VISION_API_KEY is not configured. Add the key to backend/.env and enable the Cloud Vision API.');
      }

      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      const request = {
        requests: [
          {
            image: {
              content: base64Image
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION'
              },
              {
                type: 'TEXT_DETECTION'
              }
            ]
          }
        ]
      };

      const response = await axios.post(
        `${this.endpoint}?key=${this.apiKey}`,
        request
      );

      if (response.data.responses?.[0]?.error?.message) {
        throw new Error(response.data.responses[0].error.message);
      }

      if (response.data.responses && response.data.responses[0].textAnnotations) {
        const annotations = response.data.responses[0].textAnnotations;
        return annotations.map(annotation => annotation.description).join('\n');
      }

      return '';
    } catch (error) {
      const apiMessage = error.response?.data?.error?.message || error.message;
      if (error.response?.status === 400) {
        throw new Error(`Google Vision API rejected this image or key: ${apiMessage}. Check that your API key is valid and Cloud Vision API is enabled.`);
      }
      throw new Error(`Google Vision API failed: ${apiMessage}`);
    }
  }

  parseDischargeDocumentData(rawText) {
    const normalizedText = String(rawText || '')
      .replace(/\r/g, '\n')
      .replace(/\|/g, ' ')
      .replace(/\s*[:;]+\s*/g, ': ')
      .replace(/\s+/g, ' ')
      .trim();

    const lines = normalizedText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const normalizeValue = (value) => String(value || '')
      .replace(/^[\s:;,-]+|[\s:;,-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const stopKeywords = [
      'age', 'mrn', 'diagnosis', 'disease', 'tests', 'admission', 'follow up',
      'discharge instructions', 'treatment', 'patient name', 'existing mrn'
    ];

    const cleanChunk = (chunk) => {
      let value = normalizeValue(chunk)
        .replace(/\s*(?:Age|MRN|Diagnosis|Disease|Tests|Admission|Follow Up|Discharge Instructions|Treatment|Patient Name)\s*[:\-]?\s*/i, '')
        .replace(/\s+[A-Z][a-z]+\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g, '')
        .replace(/\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*$/g, '');

      value = value.replace(/\b([A-Z])\s+(?=[A-Z])/g, '$1');
      value = value.replace(/\s*[-–—]\s*/g, ' ');
      return value.trim();
    };

    const findValue = (labelPatterns, stopPatterns = []) => {
      const patternList = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];

      for (const pattern of patternList) {
        const fullMatch = normalizedText.match(pattern);
        if (fullMatch && fullMatch[1]) {
          const chunk = fullMatch[1];
          const stopIndex = stopPatterns
            .map(stopPattern => {
              const found = chunk.search(stopPattern);
              return found >= 0 ? found : Number.MAX_SAFE_INTEGER;
            })
            .reduce((min, val) => Math.min(min, val), Number.MAX_SAFE_INTEGER);

          return cleanChunk(stopIndex === Number.MAX_SAFE_INTEGER ? chunk : chunk.slice(0, stopIndex));
        }
      }

      for (const line of lines) {
        for (const pattern of patternList) {
          const lineMatch = line.match(pattern);
          if (lineMatch && lineMatch[1]) {
            const chunk = lineMatch[1];
            const stopIndex = stopPatterns
              .map(stopPattern => {
                const found = chunk.search(stopPattern);
                return found >= 0 ? found : Number.MAX_SAFE_INTEGER;
              })
              .reduce((min, val) => Math.min(min, val), Number.MAX_SAFE_INTEGER);

            return cleanChunk(stopIndex === Number.MAX_SAFE_INTEGER ? chunk : chunk.slice(0, stopIndex));
          }
        }
      }

      return '';
    };

    const patientName = findValue([
      /(?:patient\s*name|paitent\s*name|name)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 .'-]{2,})/i,
      /(?:patient)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 .'-]{2,})/i
    ], [/age/i, /mrn/i, /diagnosis/i, /disease/i, /tests?/i, /admission/i]);

    const patientAge = findValue([
      /(?:age\s*(?:\/\s*sex|\/\s*gender)?|age)\s*[:\-]?\s*(\d{1,3})/i,
      /(\d{1,3})\s*(?:yrs?|years?|y\/o|yo)/i
    ], [/mrn/i, /diagnosis/i, /disease/i, /tests?/i, /admission/i]);

    const patientMRNRaw = findValue([
      /(?:existing\s*mrn|mrn|ipd\s*no|patient\s*id|record\s*no|uhid)\s*[:\-]?\s*([A-Za-z0-9\/-]{3,})/i
    ], [/diagnosis/i, /disease/i, /tests?/i, /admission/i, /follow\s*up/i]);
    const patientMRN = patientMRNRaw
      ? patientMRNRaw.replace(/\s+/g, '').replace(/(?<=[A-Za-z])(?=\d)/, '-').replace(/-+/g, '-')
      : '';

    const patientDisease = findValue([
      /(?:final\s*diagnosis|diagnosis|disease|condition|provisional\s*diagnosis)\s*[:\-]?\s*([A-Za-z0-9,\/.-]+(?:\s+(?!admission|tests?|follow\s*up|age|mrn|name|patient)[A-Za-z0-9,\/.-]+)*)/i
    ], [/admission/i, /tests?/i, /follow\s*up/i, /treatment/i]);

    const testDetails = findValue([
      /(?:tests?|investigations?|lab(?:oratory)?\s*(?:reports?)?|diagnostic\s*tests?)\s*[:\-]?\s*([A-Za-z0-9,\/.-]+(?:\s+(?!admission|discharge|follow\s*up|treatment|diagnosis|disease|age|mrn|name|patient)[A-Za-z0-9,\/.-]+)*)/i
    ], [/admission/i, /follow\s*up/i, /discharge/i, /treatment/i, /diagnosis/i]);

    const admissionDate = findValue([
      /(?:date\s*(?:\/\s*time)?\s*of\s*admission|admission\s*date|admitted\s*on|adm\.?\s*date)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:admission|admitted)/i
    ], [/diagnosis/i, /disease/i, /tests?/i, /follow\s*up/i]);

    const diagnosis = patientDisease || findValue([
      /diagnosis\s*[:\-]?\s*([A-Za-z0-9,\/.-]+(?:\s+(?!admission|tests?|follow\s*up|age|mrn|name|patient)[A-Za-z0-9,\/.-]+)*)/i
    ], [/admission/i, /tests?/i, /follow\s*up/i]);

    let treatment = findValue([
      /(?:treatment\s*plan|treatment|procedure|surgery|management)\s*[:\-]?\s*([A-Za-z0-9,\/. -]+(?:\s+(?!admission|diagnosis|disease|tests?|follow\s*up|age|mrn|name|patient)[A-Za-z0-9,\/. -]+)*)/i,
      /(?:treatment\s*plan)\s*[:\-]?\s*([A-Za-z0-9,\/. -]+(?:\s+(?!admission|diagnosis|disease|tests?|follow\s*up|age|mrn|name|patient)[A-Za-z0-9,\/. -]+)*)/i
    ], [/admission/i, /diagnosis/i, /disease/i, /tests?/i, /follow\s*up/i]);

    let dischargeInstructions = findValue([
      /(?:follow[-\s]*up\s*advice|discharge\s*(?:advice|instructions)|follow[-\s]*up)\s*[:\-]?\s*([A-Za-z0-9,\/. -]+(?:\s+(?!admission|diagnosis|disease|tests?|treatment|age|mrn|name|patient)[A-Za-z0-9,\/. -]+)*)/i,
      /(?:discharge\s*advice)\s*[:\-]?\s*([A-Za-z0-9,\/. -]+(?:\s+(?!admission|diagnosis|disease|tests?|treatment|age|mrn|name|patient)[A-Za-z0-9,\/. -]+)*)/i
    ], [/admission/i, /diagnosis/i, /disease/i, /tests?/i, /treatment/i]);

    const result = {
      patientName: patientName || '',
      patientAge: patientAge || '',
      patientMRN: patientMRN || '',
      patientDisease: patientDisease || '',
      testDetails: testDetails || '',
      admissionDate: admissionDate || '',
      diagnosis: diagnosis || '',
      treatment: treatment || '',
      dischargeInstructions: dischargeInstructions || ''
    };

    if (!result.treatment) {
      const treatmentLine = lines.find(line => /treatment\s*plan/i.test(line));
      if (treatmentLine) {
        const match = treatmentLine.match(/treatment\s*plan\s*[:\-]?\s*(.+)$/i);
        if (match) {
          const value = cleanChunk(match[1]);
          if (value && value.toLowerCase() !== 'plan') {
            result.treatment = value;
          }
        }
      }
    }

    if (!result.dischargeInstructions) {
      const dischargeLine = lines.find(line => /discharge\s*(?:advice|instructions)|follow[-\s]*up\s*advice/i.test(line));
      if (dischargeLine) {
        const match = dischargeLine.match(/(?:discharge\s*(?:advice|instructions)|follow[-\s]*up\s*advice)\s*[:\-]?\s*(.+)$/i);
        if (match) {
          const value = cleanChunk(match[1]);
          if (value) {
            result.dischargeInstructions = value;
          }
        }
      }
    }

    return result;
  }

  // Parse prescription data from raw text
  parsePrescriptionData(rawText) {
    const medicines = [];
    const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);

    const medicinePattern = /^(?:Rx|rx)?\s*([A-Za-z0-9\s\-]+?)(?:\s+(\d+(?:\.\d+)?)\s*(mg|gm|iu|ml|%)?)?(?:\s*-?\s*(.+))?$/i;
    const frequencyPattern = /(\d+[-\/]\d+[-\/]\d+|\d+\s*(?:times|daily|hourly|bd|od|tds|qid))/i;
    const durationPattern = /(\d+)\s*(?:days?|weeks?|months?|d|w|m)/i;
    const doctorPattern = /(?:Dr\.?|Doctor)\s*([A-Za-z\s]+?)(?:\s*[-,]|$)/i;

    let doctorName = '';
    let clinicName = '';
    let prescriptionDate = '';

    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const findField = (patterns) => {
      for (const pattern of patterns) {
        for (const line of lines) {
          const match = line.match(pattern);
          if (match) {
            return normalize(match[1]);
          }
        }
      }
      return '';
    };

    const patientName = findField([
      /(?:patient\s*name|name)\s*[:\-]\s*([A-Z][A-Za-z0-9' .-]{2,})/i,
      /(?:patient)\s*[:\-]\s*([A-Z][A-Za-z0-9' .-]{2,})/i,
      /(?:mrn|medical record no|record no)\s*[:\-]\s*\S+\s*(?:.*?)[,;-]\s*([A-Z][A-Za-z0-9' .-]{2,})/i
    ]);

    const patientAge = findField([
      /(?:age)\s*[:\-]\s*(\d{1,3})/i,
      /(\d{1,3})\s*(?:years?|yrs?|yo|y\.?o\.?)/i
    ]);

    const patientMRN = findField([
      /(?:existing\s*mrn|mrn|medical record no|record no|patient id)\s*[:\-]\s*([A-Za-z0-9-]{3,})/i
    ]);

    const patientDisease = findField([
      /(?:disease|condition|diagnosis)\s*[:\-]\s*([A-Za-z0-9\s/.-]{3,})/i,
      /(?:chief\s*complaint|presenting\s*complaint)\s*[:\-]\s*([A-Za-z0-9\s/.-]{3,})/i
    ]);

    const admissionDate = findField([
      /(?:admission\s*date|admitted\s*on|date\s*of\s*admission|admission)\s*[:\-]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
      /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:admission|admitted)/i
    ]);

    const testDetails = (() => {
      const labelPatterns = [
        /(?:test\s*details|tests?|investigations?|lab\s*reports?|diagnostic\s*tests?)\s*[:\-]/i,
        /(?:cbc|x-ray|mri|ct|blood|urine|culture|scan|ecg|echo)/i
      ];

      const relevantLines = lines.filter((line) => {
        return labelPatterns.some((pattern) => pattern.test(line));
      });

      if (relevantLines.length) {
        return relevantLines.join(' ');
      }

      const fallback = lines.find((line) => /(?:cbc|x-ray|blood|urine|scan|mri|ct|ecg|echo|culture)/i.test(line));
      return fallback ? fallback : rawText.slice(0, 250).replace(/\s+/g, ' ').trim();
    })();

    lines.forEach((line) => {
      const medicineMatch = line.match(medicinePattern);
      if (medicineMatch && medicineMatch[1].length > 3) {
        const medicineName = medicineMatch[1].trim();
        const dosage = medicineMatch[2] ? `${medicineMatch[2]}${medicineMatch[3] || 'mg'}` : '';
        const frequency = line.match(frequencyPattern)?.[0] || '';
        const duration = line.match(durationPattern)?.[0] || '';

        if (medicineName && !medicines.find(m => m.name === medicineName)) {
          medicines.push({
            name: medicineName,
            dosage: dosage,
            frequency: frequency,
            duration: duration,
            confidence: 0.85
          });
        }
      }

      if (!doctorName) {
        const doctorMatch = line.match(doctorPattern);
        if (doctorMatch) doctorName = doctorMatch[1].trim();
      }

      if (!clinicName && (line.toUpperCase().includes('HOSPITAL') || line.toUpperCase().includes('CLINIC') || line.toUpperCase().includes('CENTRE'))) {
        clinicName = line.trim();
      }

      if (!prescriptionDate) {
        const dateMatch = line.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
        if (dateMatch) prescriptionDate = dateMatch[0];
      }
    });

    const dischargeDocumentData = this.parseDischargeDocumentData(rawText);

    return {
      medicines,
      doctor: doctorName || 'Not found',
      clinicName: clinicName || 'Not found',
      date: prescriptionDate || dischargeDocumentData.admissionDate || new Date().toISOString().split('T')[0],
      patientName: patientName || dischargeDocumentData.patientName || 'Not found',
      patientAge: patientAge || dischargeDocumentData.patientAge || '',
      patientMRN: patientMRN || dischargeDocumentData.patientMRN || '',
      patientDisease: patientDisease || dischargeDocumentData.patientDisease || '',
      testDetails: testDetails || dischargeDocumentData.testDetails || '',
      admissionDate: admissionDate || dischargeDocumentData.admissionDate || '',
      diagnosis: dischargeDocumentData.diagnosis || '',
      treatment: dischargeDocumentData.treatment || '',
      dischargeInstructions: dischargeDocumentData.dischargeInstructions || '',
      rawText: rawText
    };
  }

  // Calculate overall confidence
  calculateConfidence(parsedData) {
    let totalConfidence = 0;
    let count = 0;

    if (parsedData.medicines && parsedData.medicines.length > 0) {
      totalConfidence += parsedData.medicines.reduce((sum, med) => sum + (med.confidence || 0.8), 0);
      count += parsedData.medicines.length;
    }

    if (parsedData.doctor && parsedData.doctor !== 'Not found') {
      totalConfidence += 0.9;
      count += 1;
    }

    return count > 0 ? Math.round((totalConfidence / count) * 100) : 70;
  }
}

module.exports = new OCRService();