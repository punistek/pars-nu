# Puu Nuvio Eklentileri

PuuStream / Nuvio için JavaScript eklentileri.

## Kurulum
1. Bu klasörü GitHub'da bir repoya yükle (ör. `punistek/puu-nuvio`).
2. `manifest.json` dosyasının **Raw** linkini kopyala:
   `https://raw.githubusercontent.com/punistek/puu-nuvio/main/manifest.json`
3. PuuStream → Ayarlar → **Nuvio Eklentileri** → **Depo ekle** → linki yapıştır.

## Eklentiler
| Eklenti | Tür | Not |
|---|---|---|
| Dizipal | Film + Dizi | TMDB adıyla sitede arar, bölümü bulur, AES şifreli oynatıcı ayarını çözer |

## Dizipal alan adı değişirse
`providers/dizipal.js` içindeki `DEFAULT_DOMAIN` satırını yeni adresle değiştirip
`manifest.json`'daki sürümü bir artır (1.0.0 → 1.0.1). Uygulama açılışta güncellemeyi çeker.
Yönlendirme yapan eski adreslerde yeni adres zaten otomatik bulunur.
