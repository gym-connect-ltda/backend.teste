const axios = require("axios");

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Converte um endereço (no formato salvo em filiais.endereco) em
 * latitude/longitude via Google Geocoding API.
 *
 * Retorna null se não conseguir geocodificar (endereço incompleto,
 * não encontrado, API fora do ar, etc) — geocoding é sempre "best
 * effort", nunca deve travar o cadastro/edição da filial.
 */
const geocodeAddress = async ({
  street,
  number,
  neighborhood,
  city,
  state,
  zipCode,
}) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error(
      "[geocoding] GOOGLE_MAPS_API_KEY não configurada — geocoding desabilitado.",
    );
    return null;
  }

  const addressParts = [
    street,
    number,
    neighborhood,
    city,
    state,
    zipCode,
    "Brasil",
  ].filter(Boolean);
  if (addressParts.length < 3) {
    // Endereço curto demais pra geocodificar com confiança.
    return null;
  }

  try {
    const response = await axios.get(GEOCODE_URL, {
      params: {
        address: addressParts.join(", "),
        key: apiKey,
        region: "br",
      },
      timeout: 10000,
    });

    const result = response.data?.results?.[0];
    if (!result || response.data.status !== "OK") {
      console.error(
        `[geocoding] Endereço não encontrado (status: ${response.data?.status}).`,
      );
      return null;
    }

    const { lat, lng } = result.geometry.location;
    return { latitude: lat, longitude: lng };
  } catch (err) {
    console.error(
      "[geocoding] Erro ao consultar Google Geocoding API:",
      err.message,
    );
    return null;
  }
};

module.exports = { geocodeAddress };
