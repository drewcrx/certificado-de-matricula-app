/**
 * Valida una cédula ecuatoriana con el algoritmo oficial (módulo 10),
 * incluyendo el código de provincia y el tipo de contribuyente (persona natural).
 */
export function validarCedulaEcuatoriana(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) {
    return false;
  }

  const digitos = cedula.split('').map(Number);

  const provincia = Number(cedula.substring(0, 2));
  if (provincia < 1 || provincia > 24) {
    return false;
  }

  const tercerDigito = digitos[2];
  if (tercerDigito > 6) {
    return false;
  }

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  const sumaTotal = coeficientes.reduce((suma, coeficiente, indice) => {
    let valor = digitos[indice] * coeficiente;
    if (valor >= 10) {
      valor -= 9;
    }
    return suma + valor;
  }, 0);

  const digitoVerificador = digitos[9];
  const residuo = sumaTotal % 10;
  const resultado = residuo === 0 ? 0 : 10 - residuo;

  return resultado === digitoVerificador;
}
