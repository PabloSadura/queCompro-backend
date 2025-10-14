import { expect } from 'chai';
import sinon from 'sinon';
import { getBestRecommendationFromGemini } from '../src/services/search-service/geminiService.js';
import client from '../src/config/redis.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock de la dependencia de Google Generative AI
const mockGenerateContent = sinon.stub().resolves({
  response: {
    text: () => JSON.stringify({ productos: [], recomendacion_final: 'Recomendación desde Gemini (mock)' })
  }
});

sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({
  generateContent: mockGenerateContent
});

describe('Gemini Service', () => {
  let redisGetStub;
  let redisSetStub;

  beforeEach(() => {
    // Restauramos los stubs a un estado limpio antes de cada test
    redisGetStub = sinon.stub(client, 'get');
    redisSetStub = sinon.stub(client, 'set');
    mockGenerateContent.resetHistory(); // Limpiamos el historial de llamadas a Gemini
  });

  afterEach(() => {
    sinon.restore();
  });

  it('debe devolver una recomendación desde la caché si existe', async () => {
    const userQuery = 'test query';
    const shoppingResults = [{ title: 'producto 1' }];
    const cachedData = JSON.stringify({ productos: [], recomendacion_final: 'Recomendación desde caché' });

    redisGetStub.resolves(cachedData);

    const result = await getBestRecommendationFromGemini(userQuery, shoppingResults);

    expect(result.recomendacion_final).to.equal('Recomendación desde caché');
    expect(redisGetStub.calledOnce).to.be.true;
    expect(redisSetStub.notCalled).to.be.true;
    // Importante: Verificamos que Gemini NO fue llamado
    expect(mockGenerateContent.notCalled).to.be.true;
  });

  it('debe llamar a Gemini y guardar en caché si no hay un resultado', async () => {
    const userQuery = 'new query';
    const shoppingResults = [{ title: 'producto 2' }];

    redisGetStub.resolves(null); // No hay nada en caché

    const result = await getBestRecommendationFromGemini(userQuery, shoppingResults);

    expect(result.recomendacion_final).to.equal('Recomendación desde Gemini (mock)');
    expect(redisGetStub.calledOnce).to.be.true;
    expect(redisSetStub.calledOnce).to.be.true;
    // Verificamos que la API de Gemini FUE llamada
    expect(mockGenerateContent.calledOnce).to.be.true;
  });
});
