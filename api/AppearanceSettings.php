<?php
declare(strict_types=1);

final class AppearanceSettings
{
    public const DEFAULTS = ['background'=>'#F2F7FC', 'surface'=>'#FFFFFF', 'text'=>'#18324B', 'sidebar'=>'#0B1F33', 'active'=>'#0D4558', 'accent'=>'#477DFF', 'heroStart'=>'#0B1F33', 'heroEnd'=>'#0A9F91'];

    public static function validate(array $input, array $categories): array
    {
        if (!is_array($input['colors'] ?? null) || !is_array($input['categories'] ?? null)) throw new InvalidArgumentException('اطلاعات رنگ‌بندی معتبر نیست.');
        $clean = ['colors'=>[], 'categories'=>[]];
        foreach (self::DEFAULTS as $key=>$default) {
            $color = $input['colors'][$key] ?? null;
            if (!is_string($color) || !preg_match('/^#[a-f0-9]{6}$/i', $color)) throw new InvalidArgumentException('رنگ انتخاب‌شده معتبر نیست.');
            $clean['colors'][$key] = strtoupper($color);
        }
        foreach ($categories as $category) {
            $color = $input['categories'][$category['id']] ?? $category['color'] ?? '#477DFF';
            if (!is_string($color) || !preg_match('/^#[a-f0-9]{6}$/i', $color)) throw new InvalidArgumentException('رنگ دسته‌بندی معتبر نیست.');
            $clean['categories'][$category['id']] = strtoupper($color);
        }
        return $clean;
    }

    public static function read(string $path, array $categories): array
    {
        $saved = is_file($path) ? json_decode((string)file_get_contents($path), true) : [];
        return self::validate(['colors'=>array_replace(self::DEFAULTS, $saved['colors'] ?? []), 'categories'=>$saved['categories'] ?? []], $categories);
    }

    public static function save(string $path, array $settings): void
    {
        $temp = tempnam(dirname($path), 'appearance-');
        if ($temp === false) throw new RuntimeException('پوشه تنظیمات قابل نوشتن نیست.');
        try {
            $json = json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            if (file_put_contents($temp, $json, LOCK_EX) !== strlen($json)) throw new RuntimeException('ذخیره رنگ‌بندی انجام نشد.');
            chmod($temp, 0644);
            if (!rename($temp, $path)) throw new RuntimeException('ذخیره رنگ‌بندی انجام نشد.');
        } finally {
            if (is_file($temp)) unlink($temp);
        }
    }
}
