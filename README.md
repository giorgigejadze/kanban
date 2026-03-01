# Kandan - Monday.com Kanban Board

React აპლიკაცია, რომელიც Monday.com-დან მოაქვს მონაცემები და აჩვენებს მათ Kanban დაფის სახით.

## მახასიათებლები

- 🔗 Monday.com API ინტეგრაცია (ოფციონალური)
- 🎭 **Demo რეჟიმი - მუშაობს API Key-ის გარეშე!**
- 📋 Kanban დაფის ვიზუალიზაცია
- 🎨 თანამედროვე UI დიზაინი
- 📱 რესპონსიული დიზაინი
- 🔄 მონაცემების განახლება

## დაყენება

### 1. დამოკიდებულებების დაყენება

```bash
npm install
```

### 2. აპლიკაციის გაშვება (Demo რეჟიმი)

აპლიკაცია **მუშაობს API Key-ის გარეშე** demo მონაცემებით:

```bash
npm start
```

აპლიკაცია გაიხსნება [http://localhost:3000](http://localhost:3000) და გამოიყენებს demo მონაცემებს.

### 3. Monday.com-დან რეალური მონაცემების მიღება (Backend Proxy)

**რატომ არ მოდის მონაცემები?** ბრაუზერი ბლოკავს პირდაპირ მოთხოვნებს Monday.com API-ზე (CORS). ამიტომ საჭიროა **Backend Proxy** – მცირე სერვერი, რომელიც სერვერიდან უკვე Monday.com-ს ეძახის.

1. **Backend-ის დაყენება და გაშვება:**

```bash
cd server
npm install
```

2. **Monday.com API Key** – მიიღეთ [Monday.com Developer](https://developer.monday.com/) ან Profile → API token. შექმენით `server/.env`:

```env
MONDAY_API_KEY=your_monday_api_key_here
```

3. **Backend-ის გაშვება** (ცალკე ტერმინალში):

```bash
cd server
npm start
```

სერვერი იმუშავებს `http://localhost:3001`.

4. **Frontend-ის .env** (პროექტის root-ში) – რომ ფრონტი proxy-ს გამოიყენებდეს:

```env
REACT_APP_API_URL=http://localhost:3001
```

5. **ფრონტის გაშვება** (სხვა ტერმინალში):

```bash
npm start
```

აპლიკაცია გაიხსნება [http://localhost:3000](http://localhost:3000) და მონაცემები მოვა Monday.com-დან proxy-ის მეშვეობით.

## გამოყენება

1. გაუშვით აპლიკაცია (`npm start`)
2. თუ API Key არ არის დაყენებული, აპლიკაცია ავტომატურად გადადის **Demo რეჟიმში**
3. აირჩიეთ ბორდი dropdown მენიუდან (Demo რეჟიმში 3 demo ბორდია ხელმისაწვდომი)
4. ნახეთ items Kanban დაფაზე, დაჯგუფებული groups-ის მიხედვით
5. გამოიყენეთ "განახლება" ღილაკი მონაცემების განახლებისთვის

### Demo რეჟიმი

- **API Key-ის გარეშე** აპლიკაცია ავტომატურად გამოიყენებს demo მონაცემებს
- Header-ში გამოჩნდება "Demo რეჟიმი" badge
- 3 demo ბორდია ხელმისაწვდომი: "Demo Project Board", "Marketing Tasks", "Development Sprint"
- Demo მონაცემები გამოიყენება API შეცდომების შემთხვევაშიც (fallback)

## პროექტის სტრუქტურა

```
Kandan/
├── server/                 # Backend proxy (CORS-ის გვერდის ავლა)
│   ├── server.js
│   ├── package.json
│   └── .env               # MONDAY_API_KEY=...
├── public/
│   └── index.html
├── src/
│   ├── components/
│   ├── services/
│   │   └── mondayService.js
│   ├── App.js
│   └── ...
├── .env                   # REACT_APP_API_URL=http://localhost:3001
├── package.json
└── README.md
```

## Monday.com API მოთხოვნები

აპლიკაცია იყენებს Monday.com GraphQL API-ს. დარწმუნდით, რომ თქვენს API Token-ს აქვს შემდეგი permissions:

- `boards:read` - ბორდების წაკითხვისთვის
- `items:read` - items-ების წაკითხვისთვის
- `groups:read` - groups-ების წაკითხვისთვის

## ტექნოლოგიები

- React 18
- Axios (HTTP requests)
- Monday.com GraphQL API
- CSS3 (styling)

## შენიშვნები

- **რატომ არ მოდის მონაცემები?** ბრაუზერის CORS პოლიტიკის გამო Monday.com API-ზე პირდაპირ მოთხოვნა ვერ გაიგზავნება. **ამისთვის საჭიროა `server/` Backend Proxy** – იხ. ზემოთ "Monday.com-დან რეალური მონაცემების მიღება".
- **API Key** ინახება მხოლოდ `server/.env`-ში (MONDAY_API_KEY), ფრონტზე არ სჭირდება.
- **REACT_APP_API_URL** ფრონტის `.env`-ში უნდა იყოს `http://localhost:3001` როცა backend გაშვებული გაქვთ.
- Demo რეჟიმში (proxy/API key-ის გარეშე) გამოიყენება mock მონაცემები.

## მხარდაჭერა

თუ გაქვთ შეკითხვები ან პრობლემები, გთხოვთ შექმნათ issue GitHub-ზე.
