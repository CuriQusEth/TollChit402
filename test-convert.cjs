function convertV2toV1(clientHeader) {
  try {
    const decodedStr = Buffer.from(clientHeader, 'base64').toString('utf8');
    const decoded = JSON.parse(decodedStr);
    
    if (decoded.x402Version === 2) {
      const v1Payload = {
        x402Version: 1,
        scheme: decoded.accepted?.scheme || 'exact',
        network: decoded.accepted?.network?.includes('8453') ? 'base' : 'base',
        payload: decoded.payload
      };
      return Buffer.from(JSON.stringify(v1Payload)).toString('base64');
    }
  } catch (e) {
    console.error(e);
  }
  return clientHeader;
}
console.log("Defined");
