FROM alpine

RUN apk add --update nodejs
RUN apk add --update nodejs-npm
RUN mkdir -p /usr/src/app

WORKDIR /usr/src/kvasir

COPY ./src/Index.js package.json package-lock.json /usr/src/kvasir/

RUN npm install

CMD ["node", "/usr/src/kvasir/Index.js"]