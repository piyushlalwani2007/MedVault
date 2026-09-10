module.exports = {
	apiKey: process.env.GOOGLE_VISION_API_KEY && process.env.GOOGLE_VISION_API_KEY.trim() ? process.env.GOOGLE_VISION_API_KEY.trim() : '',
	endpoint: 'https://vision.googleapis.com/v1/images:annotate',
	maxFileSize: process.env.MAX_FILE_SIZE || '50mb',
	groqApiKey: process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() ? process.env.GROQ_API_KEY.trim() : ''
};
