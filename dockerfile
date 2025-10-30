# Use uma imagem base do Node.js
FROM node:20-alpine

# Defina o diretório de trabalho dentro do container
WORKDIR /app

# Copie o package.json e package-lock.json primeiro (para cache de dependências)
COPY package*.json ./

# Instale as dependências
RUN npm install --production

# Copie o restante do código
COPY . .

# Exponha a porta do servidor (deve ser a mesma que seu app usa)
EXPOSE 3050

# Comando padrão para iniciar o app
CMD ["node", "v8ConsultaCltServer.js"]

