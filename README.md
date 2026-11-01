# Notlarım

Kişisel, çevrim dışı çalışabilen ve notları cihazında şifreli saklayan bir PWA. Ana ekranda Notlarım, Yaklaşanlar, Sabitlenmiş Not ve Ayarlar bölümleri bulunur. Notlar başlığa göre aranabilir, eklenme tarihine göre sıralanabilir; tarih duyarlı ve parola doğrulamalı olarak işaretlenebilir.

## iPhone'a kurulum

1. GitHub Pages adresini iPhone'da Safari ile aç.
2. Sayfa tamamen yüklenene kadar bekle.
3. Paylaş > Ana Ekrana Ekle ile ana ekrana ekle.
4. İlk kez çevrim içi açtıktan sonra uçak modunda tekrar açarak çevrim dışı çalışmayı dene.

Uygulama kabuğu servis çalışanı tarafından önbelleğe alınır. Uygulama not içeriği için sunucu isteği yapmaz. Güncelleme kontrolü Ayarlar içindeki düğmeyle elle başlatılır; Safari servis çalışanı dosyasını ayrıca denetleyebilir.

## Güvenlik ve yedek

- İlk açılışta en az 4 karakterli parola belirle. Parola unutulursa yerel veriler ve yedekler geri açılamaz.
- Notlar PBKDF2-SHA256 (310.000 tur) ile türetilmiş anahtar ve AES-256-GCM kullanılarak şifrelenir. Parola cihazda saklanmaz.
- Yedek dosyası şifreli JSON kapsayıcısıdır. İçe aktarma mevcut notların yerine geçer ve parola/onay ister.
- Tarihli, tamamlanmamış notlar Yaklaşanlar veya Tarihi Geçenler alanında görünür. Tek bir not ana ekrana sabitlenebilir.
- Eski yapılacaklar ve kayıt biçimleri ilk açılışta not yapısına dönüştürülür.

## Yayınlama

`main` dalına her yeni commit yüklendiğinde GitHub Actions, statik dosyaları GitHub Pages üzerinde yayınlar. Site adresi `https://denizforst.github.io/cep-listem/`.
